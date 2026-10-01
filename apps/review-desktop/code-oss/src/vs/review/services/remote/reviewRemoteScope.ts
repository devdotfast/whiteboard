/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from "../../../base/common/event.js";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.js";
import type { URI } from "../../../base/common/uri.js";
import { IBulkEditService } from "../../../editor/browser/services/bulkEditService.js";
import type { ITextModel } from "../../../editor/common/model.js";
import { ILanguageFeaturesService } from "../../../editor/common/services/languageFeatures.js";
import { IModelService } from "../../../editor/common/services/model.js";
import { ITextModelService } from "../../../editor/common/services/resolverService.js";
import { IClipboardService } from "../../../platform/clipboard/common/clipboardService.js";
import { ICommandService } from "../../../platform/commands/common/commands.js";
import { IConfigurationService } from "../../../platform/configuration/common/configuration.js";
import { IDownloadService } from "../../../platform/download/common/download.js";
import { IEnvironmentService } from "../../../platform/environment/common/environment.js";
import { ExtensionStorageService, IExtensionStorageService } from "../../../platform/extensionManagement/common/extensionStorage.js";
import type { IExtensionDescription } from "../../../platform/extensions/common/extensions.js";
import { IFileService } from "../../../platform/files/common/files.js";
import { SyncDescriptor } from "../../../platform/instantiation/common/descriptors.js";
import type { ServicesAccessor } from "../../../platform/instantiation/common/instantiation.js";
import { ServiceCollection } from "../../../platform/instantiation/common/serviceCollection.js";
import { ILabelService } from "../../../platform/label/common/label.js";
import { ILanguagePackService } from "../../../platform/languagePacks/common/languagePacks.js";
import { ILoggerService, ILogService } from "../../../platform/log/common/log.js";
import { IMarkerService } from "../../../platform/markers/common/markers.js";
import { IOpenerService } from "../../../platform/opener/common/opener.js";
import { IRemoteAuthorityResolverService, type IRemoteConnectionData, type ResolverResult } from "../../../platform/remote/common/remoteAuthorityResolver.js";
import { IRequestService } from "../../../platform/request/common/request.js";
import { ISecretStorageService } from "../../../platform/secrets/common/secrets.js";
import { IStorageService } from "../../../platform/storage/common/storage.js";
import { ITelemetryService } from "../../../platform/telemetry/common/telemetry.js";
import { ICanonicalUriService } from "../../../platform/workspace/common/canonicalUri.js";
import { IEditSessionIdentityService } from "../../../platform/workspace/common/editSessions.js";
import {
	IWorkspaceContextService,
	type IWorkspace,
	type IWorkspaceFolder,
	type IWorkspaceFoldersChangeEvent,
	WorkbenchState,
	Workspace,
	WorkspaceFolder,
} from "../../../platform/workspace/common/workspace.js";
import { IWorkspaceTrustRequestService } from "../../../platform/workspace/common/workspaceTrust.js";
import { INotificationService } from "../../../platform/notification/common/notification.js";
import { IProgressService } from "../../../platform/progress/common/progress.js";
import { IExtensionStatusBarItemService } from "../../../workbench/api/browser/statusBarExtensionPoint.js";
import { IExtensionsWorkbenchService } from "../../../workbench/contrib/extensions/common/extensions.js";
import { IWorkbenchExtensionEnablementService } from "../../../workbench/services/extensionManagement/common/extensionManagement.js";
import { IWebviewViewService } from "../../../workbench/contrib/webviewView/browser/webviewViewService.js";
import { IDecorationsService } from "../../../workbench/services/decorations/common/decorations.js";
import { IEditorGroupsService } from "../../../workbench/services/editor/common/editorGroupsService.js";
import { IEditorService } from "../../../workbench/services/editor/common/editorService.js";
import { IWorkbenchEnvironmentService } from "../../../workbench/services/environment/common/environmentService.js";
import { IExtensionService } from "../../../workbench/services/extensions/common/extensions.js";
import { ISearchService } from "../../../workbench/services/search/common/search.js";
import { SearchService } from "../../../workbench/services/search/common/searchService.js";
import { ITextFileService } from "../../../workbench/services/textfile/common/textfiles.js";
import { IWorkingCopyFileService } from "../../../workbench/services/workingCopy/common/workingCopyFileService.js";
import { IWorkspaceEditingService } from "../../../workbench/services/workspaces/common/workspaceEditing.js";
import { ILanguageStatusService } from "../../../workbench/services/languageStatus/common/languageStatusService.js";
import { ReviewRemoteBulkEditService } from "./guard/reviewRemoteBulkEditService.js";
import { ReviewRemoteCanonicalUriService } from "./guard/reviewRemoteCanonicalUriService.js";
import { ReviewRemoteClipboardService } from "./guard/reviewRemoteClipboardService.js";
import { ReviewRemoteCommandService } from "./guard/reviewRemoteCommandService.js";
import { reviewRemoteConfigurationService } from "./guard/reviewRemoteConfigurationService.js";
import { reviewRemoteDecorationsService } from "./guard/reviewRemoteDecorationsService.js";
import { reviewRemoteDiagnostics } from "./guard/reviewRemoteDiagnostics.js";
import { reviewRemoteExtensionEnablementService } from "./guard/reviewRemoteExtensionEnablementService.js";
import { reviewRemoteExtensionsWorkbenchService } from "./guard/reviewRemoteExtensionsWorkbenchService.js";
import { reviewRemoteNotificationService } from "./guard/reviewRemoteNotificationService.js";
import { reviewRemoteProgressService } from "./guard/reviewRemoteProgressService.js";
import { ReviewRemoteStatusBarItemService } from "./guard/reviewRemoteStatusBarItemService.js";
import { ReviewRemoteDownloadService } from "./guard/reviewRemoteDownloadService.js";
import { ReviewRemoteEditSessionIdentityService } from "./guard/reviewRemoteEditSessionIdentityService.js";
import { reviewRemoteEditorGroupsService } from "./guard/reviewRemoteEditorGroupsService.js";
import { reviewRemoteEditorService } from "./guard/reviewRemoteEditorService.js";
import { reviewRemoteEnvironmentService } from "./guard/reviewRemoteEnvironmentService.js";
import { reviewRemoteExtensionService } from "./guard/reviewRemoteExtensionService.js";
import { reviewRemoteFileService } from "./guard/reviewRemoteFileService.js";
import { IReviewRemoteExtensions, IReviewRemoteRefusals, override, ownsRemoteResource, ReviewRemoteRefusals } from "./guard/reviewRemoteGuard.js";
import { reviewRemoteLabelService } from "./guard/reviewRemoteLabelService.js";
import { reviewRemoteLanguagePackService } from "./guard/reviewRemoteLanguagePackService.js";
import { reviewRemoteLanguageStatusService } from "./guard/reviewRemoteLanguageStatusService.js";
import { ReviewRemoteLoggerService } from "./guard/reviewRemoteLoggerService.js";
import { reviewRemoteOpenerService } from "./guard/reviewRemoteOpenerService.js";
import "./guard/reviewRemotePeers.js";
import { reviewRemoteRequestService } from "./guard/reviewRemoteRequestService.js";
import { reviewRemoteSecretStorageService } from "./guard/reviewRemoteSecretStorageService.js";
import { reviewRemoteStorageService } from "./guard/reviewRemoteStorageService.js";
import { reviewRemoteTelemetryService } from "./guard/reviewRemoteTelemetryService.js";
import { reviewRemoteTextFileService } from "./guard/reviewRemoteTextFileService.js";
import { reviewRemoteTextModelService } from "./guard/reviewRemoteTextModelService.js";
import { reviewRemoteWebviewViewService } from "./guard/reviewRemoteWebviewViewService.js";
import { IWebviewWorkbenchServiceId, reviewRemoteWebviewWorkbenchService } from "./guard/reviewRemoteWebviewWorkbenchService.js";
import { ReviewRemoteWorkspaceEditingService } from "./guard/reviewRemoteWorkspaceEditingService.js";
import { reviewRemoteWorkingCopyFileService } from "./guard/reviewRemoteWorkingCopyFileService.js";
import { reviewRemoteWorkspaceTrustRequestService } from "./guard/reviewRemoteWorkspaceTrustRequestService.js";

export { ownsRemoteResource };

/**
 * `whiteboard+<serverId>`, lower case since URIs come back from a remote with
 * a lower-case authority. The alias is only a label, so renaming it moves no URI.
 */
export function reviewRemoteAuthority(serverId: string): string | undefined {
	return /^[0-9a-z-]+$/i.test(serverId) ? `whiteboard+${serverId.toLowerCase()}` : undefined;
}

/** Only this host's remote models reach its extension host. */
export function reviewRemoteModelService(base: IModelService, authority: string): IModelService {
	const mine = (model: ITextModel) => ownsRemoteResource(authority, model.uri);
	return override(base, {
		getModels: () => base.getModels().filter(mine),
		getModel: (resource: URI) => (ownsRemoteResource(authority, resource) ? base.getModel(resource) : null),
		onModelAdded: Event.filter(base.onModelAdded, mine),
		onModelRemoved: Event.filter(base.onModelRemoved, mine),
		onModelLanguageChanged: Event.filter(base.onModelLanguageChanged, (event) => mine(event.model)),
	});
}

/**
 * Owners are namespaced by host, so one host clearing `typescript` leaves the
 * others' markers, and a host reads and writes markers of its own files only.
 */
export function reviewRemoteMarkerService(base: IMarkerService, authority: string): IMarkerService {
	const owner = (name: string) => `${authority}/${name}`;
	const mine = (resource: URI) => ownsRemoteResource(authority, resource);
	return override(base, {
		changeOne: (name, resource, markers) => {
			if (mine(resource)) base.changeOne(owner(name), resource, markers);
		},
		changeAll: (name, data) => base.changeAll(owner(name), data.filter((entry) => mine(entry.resource))),
		remove: (name, resources) => base.remove(owner(name), resources.filter(mine)),
		read: (filter) =>
			base.read(filter?.owner ? { ...filter, owner: owner(filter.owner) } : filter).filter((marker) => mine(marker.resource)),
		onMarkerChanged: Event.filter(
			Event.map(base.onMarkerChanged, (resources) => resources.filter(mine)),
			(resources) => resources.length > 0,
		),
	});
}

/** A host's resolver answers for its own authority with the address it is given. */
export function reviewRemoteResolver(
	base: IRemoteAuthorityResolverService,
	authority: string,
	address: () => Promise<IRemoteConnectionData>,
): IRemoteAuthorityResolverService {
	let last: IRemoteConnectionData | null = null;
	return override(base, {
		resolveAuthority: async (name: string): Promise<ResolverResult> => {
			if (name !== authority) return base.resolveAuthority(name);
			last = await address();
			return { authority: { authority, ...last }, options: {} };
		},
		getConnectionData: (name: string) => (name === authority ? last : base.getConnectionData(name)),
	});
}

/** A host's workspace: only the roots of its own reviews, counted per caller. */
export class ReviewRemoteWorkspace extends Disposable implements IWorkspaceContextService {
	declare readonly _serviceBrand: undefined;

	private readonly counts = new Map<string, { uri: URI; count: number }>();
	private readonly workspace: Workspace;
	private readonly foldersChanged = this._register(new Emitter<IWorkspaceFoldersChangeEvent>());
	readonly onDidChangeWorkspaceFolders = this.foldersChanged.event;
	readonly onWillChangeWorkspaceFolders = Event.None;
	readonly onDidChangeWorkbenchState = Event.None;
	readonly onDidChangeWorkspaceName = Event.None;

	constructor(id: string) {
		super();
		this.workspace = new Workspace(id, [], false, null, () => false);
	}

	add(root: URI): IDisposable {
		const key = root.toString();
		const entry = this.counts.get(key);
		if (entry) entry.count++;
		else {
			this.counts.set(key, { uri: root, count: 1 });
			this.update();
		}
		let disposed = false;
		return {
			dispose: () => {
				if (disposed) return;
				disposed = true;
				const current = this.counts.get(key);
				if (current && --current.count === 0) {
					this.counts.delete(key);
					this.update();
				}
			},
		};
	}

	private update(): void {
		const before = this.workspace.folders;
		const after = [...this.counts.values()].map(
			({ uri }, index) => new WorkspaceFolder({ uri, index, name: uri.path.split("/").pop() || uri.path }),
		);
		const keys = (folders: readonly IWorkspaceFolder[]) => new Set(folders.map((folder) => folder.uri.toString()));
		const [had, has] = [keys(before), keys(after)];
		this.workspace.folders = after;
		this.foldersChanged.fire({
			added: after.filter((folder) => !had.has(folder.uri.toString())),
			removed: before.filter((folder) => !has.has(folder.uri.toString())),
			changed: [],
		});
	}

	getCompleteWorkspace(): Promise<IWorkspace> {
		return Promise.resolve(this.workspace);
	}

	getWorkspace(): IWorkspace {
		return this.workspace;
	}

	getWorkbenchState(): WorkbenchState {
		return WorkbenchState.WORKSPACE;
	}

	getWorkspaceFolder(resource: URI): IWorkspaceFolder | null {
		return this.workspace.getFolder(resource);
	}

	isCurrentWorkspace(): boolean {
		return false;
	}

	isInsideWorkspace(resource: URI): boolean {
		return !!this.workspace.getFolder(resource);
	}

	hasWorkspaceData(): boolean {
		return true;
	}
}

/**
 * The services a host's extension host and its main-thread peers see in place
 * of the window's. Everything not listed is the window's own. From the
 * refusals on, these are the guard (D20): what a remote's extensions can reach
 * on the laptop. `window` is the window's accessor, used during this call only.
 */
export function reviewRemoteScope(input: {
	authority: string;
	/** The alias for refusals, once known. */
	name: () => string;
	extensions: readonly IExtensionDescription[];
	/** Activates an event in this host's extension host. */
	activate: (event: string) => Promise<void>;
	languageFeatures: ILanguageFeaturesService;
	workspace: ReviewRemoteWorkspace;
	resolver: IRemoteAuthorityResolverService;
	/** This host's own files through its own connection, writable. */
	ownFiles: IFileService;
}, window: ServicesAccessor): ServiceCollection {
	const { authority } = input;
	const logService = window.get(ILogService);
	const refusals = new ReviewRemoteRefusals(authority, input.name, logService);
	const groups = reviewRemoteEditorGroupsService(window.get(IEditorGroupsService), refusals);
	const environment = reviewRemoteEnvironmentService(window.get(IWorkbenchEnvironmentService));
	return new ServiceCollection(
		[ILanguageFeaturesService, input.languageFeatures],
		[IModelService, reviewRemoteModelService(window.get(IModelService), authority)],
		[IWorkspaceContextService, input.workspace],
		[IMarkerService, reviewRemoteDiagnostics(reviewRemoteMarkerService(window.get(IMarkerService), authority), refusals)],
		// Its own instance, so a file search from this host's extensions reaches this host's search provider.
		[ISearchService, new SyncDescriptor(SearchService)],
		[IRemoteAuthorityResolverService, input.resolver],
		[IReviewRemoteRefusals, refusals],
		[IReviewRemoteExtensions, { _serviceBrand: undefined, extensions: input.extensions }],
		[IFileService, reviewRemoteFileService(window.get(IFileService), refusals, input.ownFiles)],
		[ITextModelService, reviewRemoteTextModelService(window.get(ITextModelService), refusals)],
		[ITextFileService, reviewRemoteTextFileService(window.get(ITextFileService), refusals)],
		[IWorkingCopyFileService, reviewRemoteWorkingCopyFileService(window.get(IWorkingCopyFileService), refusals)],
		[IBulkEditService, new ReviewRemoteBulkEditService(refusals)],
		[IEditorGroupsService, groups],
		[IEditorService, reviewRemoteEditorService(window.get(IEditorService), groups, refusals)],
		[IOpenerService, reviewRemoteOpenerService(window.get(IOpenerService), refusals)],
		[ICommandService, new SyncDescriptor(ReviewRemoteCommandService)],
		[IConfigurationService, reviewRemoteConfigurationService(window.get(IConfigurationService), input.extensions, refusals, logService)],
		[IClipboardService, new ReviewRemoteClipboardService(refusals)],
		[IDownloadService, new ReviewRemoteDownloadService(refusals)],
		[ILoggerService, new ReviewRemoteLoggerService(window.get(ILoggerService), refusals)],
		[IStorageService, reviewRemoteStorageService(window.get(IStorageService), authority)],
		// Its own instance, on the prefixed storage.
		[IExtensionStorageService, new SyncDescriptor(ExtensionStorageService)],
		[ISecretStorageService, reviewRemoteSecretStorageService(window.get(ISecretStorageService), authority)],
		[IWebviewWorkbenchServiceId, reviewRemoteWebviewWorkbenchService(window.get(IWebviewWorkbenchServiceId), refusals)],
		[IWebviewViewService, reviewRemoteWebviewViewService(window.get(IWebviewViewService), refusals)],
		[ILabelService, reviewRemoteLabelService(window.get(ILabelService), refusals)],
		[IDecorationsService, reviewRemoteDecorationsService(window.get(IDecorationsService), refusals)],
		[IWorkspaceEditingService, new ReviewRemoteWorkspaceEditingService(refusals)],
		[IWorkspaceTrustRequestService, reviewRemoteWorkspaceTrustRequestService(window.get(IWorkspaceTrustRequestService), refusals)],
		[ICanonicalUriService, new ReviewRemoteCanonicalUriService(refusals)],
		[IEditSessionIdentityService, new ReviewRemoteEditSessionIdentityService(refusals)],
		[IRequestService, reviewRemoteRequestService(window.get(IRequestService), refusals)],
		[ILanguagePackService, reviewRemoteLanguagePackService(window.get(ILanguagePackService))],
		[ITelemetryService, reviewRemoteTelemetryService(window.get(ITelemetryService))],
		[IWorkbenchEnvironmentService, environment],
		[IEnvironmentService, environment],
		[IExtensionService, reviewRemoteExtensionService(window.get(IExtensionService), input.extensions, input.activate)],
		[IExtensionsWorkbenchService, reviewRemoteExtensionsWorkbenchService(window.get(IExtensionsWorkbenchService), refusals)],
		[IWorkbenchExtensionEnablementService, reviewRemoteExtensionEnablementService(window.get(IWorkbenchExtensionEnablementService), refusals)],
		// Window UI a host writes into: its links and commands go through this guard.
		[INotificationService, reviewRemoteNotificationService(window.get(INotificationService), refusals)],
		[IProgressService, reviewRemoteProgressService(window.get(IProgressService), refusals)],
		[IExtensionStatusBarItemService, new SyncDescriptor(ReviewRemoteStatusBarItemService, [window.get(IExtensionStatusBarItemService)])],
		[ILanguageStatusService, reviewRemoteLanguageStatusService(window.get(ILanguageStatusService), refusals)],
	);
}
