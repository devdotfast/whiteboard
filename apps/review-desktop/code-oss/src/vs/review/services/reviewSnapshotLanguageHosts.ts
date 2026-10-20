import { hash } from "../../base/common/hash.js";
import { Disposable, type IDisposable } from "../../base/common/lifecycle.js";
import { isEqualOrParent } from "../../base/common/resources.js";
import { URI } from "../../base/common/uri.js";
import { LanguageFeaturesService } from "../../editor/common/services/languageFeaturesService.js";
import { IFileService } from "../../platform/files/common/files.js";
import { InstantiationType, registerSingleton } from "../../platform/instantiation/common/extensions.js";
import { IInstantiationService } from "../../platform/instantiation/common/instantiation.js";
import { ILogService } from "../../platform/log/common/log.js";
import { IRemoteAuthorityResolverService } from "../../platform/remote/common/remoteAuthorityResolver.js";
import { INativeWorkbenchEnvironmentService } from "../../workbench/services/environment/electron-browser/environmentService.js";
import { ActivationKind, ExtensionHostStartup, IExtensionService } from "../../workbench/services/extensions/common/extensions.js";
import { ExtensionHostManager } from "../../workbench/services/extensions/common/extensionHostManager.js";
import { LocalProcessRunningLocation } from "../../workbench/services/extensions/common/extensionRunningLocation.js";
import { NativeLocalProcessExtensionHost } from "../../workbench/services/extensions/electron-browser/localProcessExtensionHost.js";
import { ReviewWorkspaceHostExtensions, reviewSnapshotExtensionIds } from "../common/reviewWorkspaceLanguageActivation.js";
import { override } from "./remote/reviewRemoteAuthority.js";
import { type IReviewRemoteHost } from "./remote/reviewRemoteHost.js";
import { ReviewRemoteWorkspace, reviewRemoteScope } from "./remote/reviewRemoteScope.js";

import { IReviewSnapshotLanguageHosts, ReviewLanguageHostPool } from "./reviewLanguageHosts.js";

/** A normal, single-checkout extension workspace behind each saved snapshot. */
export class ReviewSnapshotLanguageHosts extends ReviewLanguageHostPool implements IReviewSnapshotLanguageHosts {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExtensionService private readonly extensions: IExtensionService,
		@ILogService private readonly log: ILogService,
	) {
		super();
	}

	protected override async open(root: URI): Promise<SnapshotLanguageHost> {
		await this.extensions.whenInstalledExtensionsRegistered();
		const host = this.instantiationService.createInstance(SnapshotLanguageHost, root);
		try {
			await host.start(this.extensions);
			return host;
		} catch (error) {
			host.dispose();
			this.log.error("[Whiteboard] Snapshot language host failed", error);
			throw error;
		}
	}
}

class SnapshotLanguageHost extends Disposable implements IReviewRemoteHost {
	readonly languageFeatures = new LanguageFeaturesService();
	readonly authority = "";
	get closed(): boolean {
		return this._store.isDisposed;
	}
	private manager?: ExtensionHostManager;
	private readonly workspace: ReviewRemoteWorkspace;
	private readonly id: string;

	constructor(
		private readonly root: URI,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INativeWorkbenchEnvironmentService private readonly environment: INativeWorkbenchEnvironmentService,
		@IFileService private readonly files: IFileService,
		@ILogService private readonly log: ILogService,
	) {
		super();
		this.id = `review-snapshot-${hash(root.toString()).toString(16)}`;
		this.workspace = this._register(new ReviewRemoteWorkspace(this.id));
		this._register(this.workspace.add(root));
	}

	async start(extensionService: IExtensionService): Promise<void> {
		const extensions = extensionService.extensions;
		const ids = new Set(reviewSnapshotExtensionIds);
		const descriptions = new Map(extensions.map((extension) => [extension.identifier.value.toLowerCase(), extension]));
		// Dependencies belong to the same host, including indirect support extensions.
		for (const id of ids) {
			for (const dependency of descriptions.get(id)?.extensionDependencies ?? []) ids.add(dependency.toLowerCase());
		}
		const runnable = extensions
			.filter((extension) => ids.has(extension.identifier.value.toLowerCase()))
			.map((extension) => extension.identifier);
		const storage = URI.joinPath(this.environment.workspaceStorageHome, this.id);
		await this.files.createFolder(storage);
		const scope = this._register(
			this.instantiationService.createChild(
				this.instantiationService.invokeFunction((window) => {
					const services = reviewRemoteScope(
						{
							authority: "",
							storageId: this.id,
							extensions,
							activate: (event) => this.activateByEvent(event),
							languageFeatures: this.languageFeatures,
							workspace: this.workspace,
							resolver: window.get(IRemoteAuthorityResolverService),
							owns: (resource) => isEqualOrParent(resource, this.root),
						},
						window,
					);
					services.set(
						INativeWorkbenchEnvironmentService,
						override(this.environment, {
							workspaceStorageHome: storage,
							extHostLogsPath: URI.joinPath(this.environment.extHostLogsPath, this.id),
						}),
					);
					return services;
				}),
			),
		);
		const extensionHost = scope.createInstance(
			NativeLocalProcessExtensionHost,
			new LocalProcessRunningLocation(0),
			ExtensionHostStartup.EagerAutoStart,
			{
				getInitData: async () => ({ extensions: new ReviewWorkspaceHostExtensions(1, extensions, runnable) }),
			},
		);
		this.manager = this._register(
			scope.createInstance(ExtensionHostManager, extensionHost, [], {
				_activateById: async (id, reason) => {
					await this.manager!.activate(id, reason);
				},
				_onWillActivateExtension: () => {},
				_onDidActivateExtension: (id) => this.log.info(`[Snapshot language] ${this.id}: ${id.value}`),
				_onDidActivateExtensionError: (id, error) => this.log.error(`[Snapshot language] ${id.value}`, error),
				_onExtensionRuntimeError: (id, error) => this.log.error(`[Snapshot language] ${id.value}`, error),
			}),
		);
		this._register(this.manager.onDidExit(() => this.dispose()));
		await this.manager.ready();
	}

	async addRoot(root: URI): Promise<IDisposable> {
		if (root.toString() !== this.root.toString()) throw new Error("A snapshot host cannot add another checkout.");
		return Disposable.None;
	}

	async activateByEvent(event: string): Promise<void> {
		await this.manager?.activateByEvent(event, ActivationKind.Normal);
	}

	override dispose(): void {
		void this.manager?.disconnect().catch((error) => this.log.debug("[Snapshot language] Disconnect failed", error));
		super.dispose();
	}
}

registerSingleton(IReviewSnapshotLanguageHosts, ReviewSnapshotLanguageHosts, InstantiationType.Delayed);
