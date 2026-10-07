/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, raceTimeout, TimeoutTimer } from "../../../base/common/async.js";
import { toErrorMessage } from "../../../base/common/errorMessage.js";
import { CancellationError } from "../../../base/common/errors.js";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.js";
import * as platform from "../../../base/common/platform.js";
import type { Mutable } from "../../../base/common/types.js";
import { URI } from "../../../base/common/uri.js";
import type { ILanguageFeaturesService } from "../../../editor/common/services/languageFeatures.js";
import { LanguageFeaturesService } from "../../../editor/common/services/languageFeaturesService.js";
import type { IExtensionDescription } from "../../../platform/extensions/common/extensions.js";
import { DiskFileSystemProviderClient } from "../../../platform/files/common/diskFileSystemProviderClient.js";
import { IInstantiationService } from "../../../platform/instantiation/common/instantiation.js";
import { ILogService } from "../../../platform/log/common/log.js";
import { IProductService } from "../../../platform/product/common/productService.js";
import {
	connectRemoteAgentManagement,
	type IConnectionOptions,
	PersistentConnectionEventType,
} from "../../../platform/remote/common/remoteAgentConnection.js";
import {
	IRemoteAuthorityResolverService,
	type IRemoteConnectionData,
	RemoteAuthorityResolverError,
	RemoteAuthorityResolverErrorCode,
	WebSocketRemoteConnection,
} from "../../../platform/remote/common/remoteAuthorityResolver.js";
import { RemoteExtensionsScannerChannelName } from "../../../platform/remote/common/remoteExtensionsScanner.js";
import { IRemoteSocketFactoryService } from "../../../platform/remote/common/remoteSocketFactoryService.js";
import { ISignService } from "../../../platform/sign/common/sign.js";
import { ExtensionHostManager } from "../../../workbench/services/extensions/common/extensionHostManager.js";
import { RemoteRunningLocation } from "../../../workbench/services/extensions/common/extensionRunningLocation.js";
import {
	ActivationKind,
	ExtensionHostExtensions,
	type IInternalExtensionService,
} from "../../../workbench/services/extensions/common/extensions.js";
import { RemoteExtensionHost } from "../../../workbench/services/extensions/common/remoteExtensionHost.js";
import { RemoteExtensionEnvironmentChannelClient } from "../../../workbench/services/remote/common/remoteAgentEnvironmentChannel.js";
import { REMOTE_FILE_SYSTEM_CHANNEL_NAME } from "../../../workbench/services/remote/common/remoteFileSystemProviderClient.js";
import { IReviewDesktopConnectionService, type ReviewRemoteLanguageEndpoint } from "../reviewDesktopConnectionService.js";
import type { ReviewRemoteFileSystemRouter } from "./reviewRemoteFileSystemRouter.js";
import { ownsRemoteResource } from "./reviewRemoteAuthority.js";
import { ReviewRemoteWorkspace, reviewRemoteResolver, reviewRemoteScope } from "./reviewRemoteScope.js";

export interface IReviewRemoteHost {
	readonly authority: string;
	readonly languageFeatures: ILanguageFeaturesService;
	addRoot(root: URI): Promise<IDisposable>;
	activateByEvent(event: string): Promise<void>;
}

export interface IReviewRemoteSession extends IDisposable {
	readonly failed: Promise<string>;
	activateByEvent(event: string): Promise<void>;
	close(): Promise<void>;
}

function reviewRemoteRetryDelay(failures: number): number {
	return Math.min(60_000, 1_000 * 2 ** failures);
}

const STABLE_MS = 60_000;

const PROBE_MS = 5_000;

export class ReviewRemoteHost extends Disposable implements IReviewRemoteHost {
	readonly languageFeatures: ILanguageFeaturesService = new LanguageFeaturesService();
	readonly workspace: ReviewRemoteWorkspace;
	private session: IReviewRemoteSession | undefined;
	private connecting: Promise<boolean> | undefined;
	private failures = 0;
	private waiting = false;
	private probing: Promise<boolean> | undefined;
	private probed = -Infinity;
	private probedEndpoint: string | undefined;
	private readonly retry = this._register(new TimeoutTimer());
	private readonly activations = new Set<string>();

	constructor(
		readonly serverId: string,
		readonly authority: string,
		private readonly open: (host: ReviewRemoteHost) => Promise<IReviewRemoteSession | undefined>,
		private readonly endpoint: () => Promise<string | undefined>,
		private readonly logService: ILogService,
	) {
		super();
		this.workspace = this._register(new ReviewRemoteWorkspace(`whiteboard-remote-${serverId}`));
	}

	connect(): Promise<boolean> {
		if (this.session) return Promise.resolve(true);
		if (this._store.isDisposed) return Promise.resolve(false);
		if (this.waiting) return this.probe();
		this.connecting ??= this.attempt().finally(() => (this.connecting = undefined));
		return this.connecting;
	}

	private probe(): Promise<boolean> {
		if (this.probing || Date.now() - this.probed < PROBE_MS) return this.probing ?? Promise.resolve(false);
		this.probed = Date.now();
		this.probing = (async () => {
			const endpoint = await this.endpoint().catch(() => undefined);
			if (this.waiting && endpoint && endpoint !== this.probedEndpoint) {
				this.probedEndpoint = endpoint;
				this.retry.cancel();
				this.waiting = false;
				this.failures = 0;
			}
			return this.waiting ? false : this.connect();
		})().finally(() => (this.probing = undefined));
		return this.probing;
	}

	private async attempt(): Promise<boolean> {
		let session: IReviewRemoteSession | undefined;
		try {
			session = await this.open(this);
		} catch (error) {
			this.logService.warn(`[Remote language] ${this.authority}: could not connect: ${toErrorMessage(error)}`);
		}
		if (this._store.isDisposed) {
			session?.dispose();
			return false;
		}
		if (!session) {
			this.retryLater();
			return false;
		}
		const opened = Date.now();
		this.session = session;
		void session.failed.then((reason) => {
			if (this.session !== session) return;
			this.logService.warn(`[Remote language] ${this.authority}: ${reason} failed; connecting again`);
			this.session = undefined;
			session.dispose();
			if (Date.now() - opened >= STABLE_MS) this.failures = 0;
			this.retryLater();
		});
		for (const event of this.activations) {
			session.activateByEvent(event).catch((error) => this.logService.warn(`[Remote language] ${this.authority}: ${event} failed: ${toErrorMessage(error)}`));
		}
		return true;
	}

	private retryLater(): void {
		this.waiting = true;
		this.retry.cancelAndSet(() => {
			this.waiting = false;
			void this.connect();
		}, reviewRemoteRetryDelay(this.failures++));
	}

	async addRoot(root: URI): Promise<IDisposable> {
		if (!ownsRemoteResource(this.authority, root)) throw new Error("That root is not on this remote host.");
		return this.workspace.add(root);
	}

	async activateByEvent(event: string): Promise<void> {
		this.activations.add(event);
		await this.session?.activateByEvent(event);
	}

	async close(): Promise<void> {
		if (this.connecting) await raceTimeout(this.connecting, 2_000);
		const session = this.session;
		this.session = undefined;
		this.dispose();
		if (!session) return;
		try {
			await session.close();
		} finally {
			session.dispose();
		}
	}

	override dispose(): void {
		this.session?.dispose();
		this.session = undefined;
		super.dispose();
	}
}

class ReviewRemoteExtensionHost extends RemoteExtensionHost {
	private readonly startResult = new DeferredPromise<void>();
	readonly started = this.startResult.p;

	override start() {
		const started = super.start();
		started.then(() => this.startResult.complete(), (error) => this.startResult.error(error));
		return started;
	}
}

export class ReviewRemoteSession extends Disposable implements IReviewRemoteSession {
	private readonly failure = new DeferredPromise<string>();
	readonly failed = this.failure.p;
	private manager: ExtensionHostManager | undefined;
	private started = false;

	constructor(
		private readonly host: ReviewRemoteHost,
		private endpoint: ReviewRemoteLanguageEndpoint | undefined,
		private readonly router: ReviewRemoteFileSystemRouter,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IProductService private readonly productService: IProductService,
		@IRemoteSocketFactoryService private readonly remoteSocketFactoryService: IRemoteSocketFactoryService,
		@ISignService private readonly signService: ISignService,
		@ILogService private readonly logService: ILogService,
		@IRemoteAuthorityResolverService private readonly resolverService: IRemoteAuthorityResolverService,
		@IReviewDesktopConnectionService private readonly connection: IReviewDesktopConnectionService,
	) {
		super();
	}

	private async address(): Promise<IRemoteConnectionData> {
		const endpoint = this.started ? await this.connection.getRemoteLanguageEndpoint(this.host.serverId) : this.endpoint;
		if (!endpoint) throw new RemoteAuthorityResolverError("The remote host is not available.", RemoteAuthorityResolverErrorCode.TemporarilyNotAvailable);
		return { connectTo: new WebSocketRemoteConnection(endpoint.host, endpoint.port), connectionToken: endpoint.connectionToken };
	}

	private options(): IConnectionOptions {
		return {
			commit: this.productService.commit,
			quality: this.productService.quality,
			addressProvider: { getAddress: () => this.address() },
			remoteSocketFactoryService: this.remoteSocketFactoryService,
			signService: this.signService,
			logService: this.logService,
			ipcLogger: null,
		};
	}

	private fail(reason: string): void {
		if (!this.failure.isSettled) this.failure.complete(reason);
	}

	private check(): void {
		if (this._store.isDisposed) throw new CancellationError();
		if (this.failure.isSettled) throw new Error("A connection failed while it started.");
	}

	async start(): Promise<void> {
		const { authority } = this.host;
		const management = await connectRemoteAgentManagement(this.options(), authority, "renderer");
		if (this._store.isDisposed) {
			management.dispose();
			throw new CancellationError();
		}
		this._register(management);
		this._register(management.onDidStateChange((event) => {
			if (event.type === PersistentConnectionEventType.ReconnectionPermanentFailure) this.fail("the Management connection");
		}));
		const environment = await RemoteExtensionEnvironmentChannelClient.getEnvironmentData(
			management.client.getChannel("remoteextensionsenvironment"),
			authority,
			undefined,
		);
		if (environment.reconnectionGraceTime !== undefined) management.updateGraceTime(environment.reconnectionGraceTime);
		const extensions = await management.client
			.getChannel(RemoteExtensionsScannerChannelName)
			.call<Mutable<IExtensionDescription>[]>("scanExtensions", [platform.language, undefined, [], undefined, undefined]);
		for (const extension of extensions) extension.extensionLocation = URI.revive(extension.extensionLocation);
		this.check();

		const files = this._register(new DiskFileSystemProviderClient(management.client.getChannel(REMOTE_FILE_SYSTEM_CHANNEL_NAME), { pathCaseSensitive: true }));
		this._register(this.router.add(authority, files));

		const scope = this._register(this.instantiationService.createChild(this.instantiationService.invokeFunction((window) => reviewRemoteScope({
			authority,
			extensions,
			activate: (event) => this.activateByEvent(event),
			languageFeatures: this.host.languageFeatures,
			workspace: this.host.workspace,
			resolver: reviewRemoteResolver(this.resolverService, authority, () => this.address()),
		}, window))));
		const extensionHost = scope.createInstance(ReviewRemoteExtensionHost, new RemoteRunningLocation(), {
			remoteAuthority: authority,
			getInitData: async () => ({
				connectionData: await this.address(),
				pid: environment.pid,
				appRoot: environment.appRoot,
				extensionHostLogsPath: environment.extensionHostLogsPath,
				globalStorageHome: environment.globalStorageHome,
				workspaceStorageHome: environment.workspaceStorageHome,
				extensions: new ExtensionHostExtensions(1, extensions, extensions.filter((extension) => extension.main).map((extension) => extension.identifier)),
			}),
		});
		const manager = (this.manager = this._register(scope.createInstance(ExtensionHostManager, extensionHost, [], this.internalExtensionService())));
		this._register(manager.onDidExit(() => this.fail("the extension host connection")));
		await extensionHost.started;
		await manager.ready();
		this.check();
		this.started = true;
		this.endpoint = undefined;
	}

	private internalExtensionService(): IInternalExtensionService {
		const log = (message: string) => this.logService.info(`[Remote language] ${this.host.authority}: ${message}`);
		return {
			_activateById: async (id, reason) => {
				await this.manager?.activate(id, reason);
			},
			_onWillActivateExtension: () => { },
			_onDidActivateExtension: (id) => log(`activated ${id.value}`),
			_onDidActivateExtensionError: (id, error) => log(`${id.value} failed to activate: ${toErrorMessage(error)}`),
			_onExtensionRuntimeError: (id, error) => log(`${id.value}: ${toErrorMessage(error)}`),
		};
	}

	async activateByEvent(event: string): Promise<void> {
		await this.manager?.activateByEvent(event, ActivationKind.Normal);
	}

	async close(): Promise<void> {
		await raceTimeout(this.manager?.disconnect() ?? Promise.resolve(), 2_000);
		this.dispose();
	}
}
