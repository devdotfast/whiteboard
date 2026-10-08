/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// The native workbench owns layout, navigation, file search and text search.
// Review's canvas, workspace adapters and Agents-window defaults stay in its
// own entry point; the editor/extension-host services are shared.
import './editor.common.main.js';
import './editor.desktop.main.js';
import { reviewConfigurationDefaults, reviewSourceWindowDefaults } from './common/reviewConfigurationDefaults.js';
import '../workbench/browser/workbench.zenMode.contribution.js';
import '../workbench/browser/actions/layoutActions.js';
import '../workbench/browser/parts/editor/editorParts.js';
import '../workbench/browser/parts/paneCompositePartService.js';
import '../workbench/browser/parts/banner/bannerPart.js';
import '../workbench/browser/parts/statusbar/statusbarPart.js';
import '../workbench/browser/parts/titlebar/menubar.contribution.js';
import '../workbench/services/title/electron-browser/titleService.js';
import '../workbench/services/workspaces/electron-browser/workspaceEditingService.js';
import '../workbench/contrib/search/browser/search.contribution.js';
import '../workbench/contrib/searchEditor/browser/searchEditor.contribution.js';
import '../workbench/services/notebook/common/notebookDocumentService.js';
import '../workbench/services/aiRelatedInformation/common/aiRelatedInformationService.js';
import { registerAction2 } from '../platform/actions/common/actions.js';
import { Extensions as QuickAccessExtensions, IQuickAccessRegistry } from '../platform/quickinput/common/quickAccess.js';
import { CommandsQuickAccessProvider, ShowAllCommandsAction } from '../workbench/contrib/quickaccess/browser/commandsQuickAccess.js';
import { ChatAgentService, IChatAgentService } from '../workbench/contrib/chat/common/participants/chatAgents.js';
import { InstantiationType, registerSingleton } from '../platform/instantiation/common/extensions.js';
import { INotebookService } from '../workbench/contrib/notebook/common/notebookService.js';
import { NotebookService } from '../workbench/contrib/notebook/browser/services/notebookServiceImpl.js';
import { INotebookEditorService } from '../workbench/contrib/notebook/browser/services/notebookEditorService.js';
import { NotebookEditorWidgetService } from '../workbench/contrib/notebook/browser/services/notebookEditorServiceImpl.js';
import { INotebookEditorModelResolverService } from '../workbench/contrib/notebook/common/notebookEditorModelResolverService.js';
import { NotebookModelResolverServiceImpl } from '../workbench/contrib/notebook/common/notebookEditorModelResolverServiceImpl.js';
import { ISCMService } from '../workbench/contrib/scm/common/scm.js';
import { SCMService } from '../workbench/contrib/scm/common/scmService.js';
import { Registry } from '../platform/registry/common/platform.js';
import { Extensions, IConfigurationRegistry } from '../platform/configuration/common/configurationRegistry.js';
import { IStorageService, StorageScope, StorageTarget } from '../platform/storage/common/storage.js';
import { AccountsActivityActionViewItem } from '../workbench/browser/parts/globalCompositeBar.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../workbench/common/contributions.js';
import { URI } from '../base/common/uri.js';
import { getCodeEditor } from '../editor/browser/editorBrowser.js';
import { Position } from '../editor/common/core/position.js';
import { ILanguageFeaturesService } from '../editor/common/services/languageFeatures.js';
import { SymbolNavigationAnchor } from '../editor/contrib/gotoSymbol/browser/goToCommands.js';
import { CommandsRegistry, ICommandService } from '../platform/commands/common/commands.js';
import { IEditorService } from '../workbench/services/editor/common/editorService.js';
import { NativeExtensionService } from '../workbench/services/extensions/electron-browser/nativeExtensionService.js';
import { IExtensionService } from '../workbench/services/extensions/common/extensions.js';
import { ReviewExtensionGalleryManifestService, ReviewExtensionManagementServerService } from './services/remote/reviewRemoteWindowExtensionManagement.js';
import { IExtensionManagementServerService } from '../workbench/services/extensionManagement/common/extensionManagement.js';
import { IExtensionGalleryManifestService } from '../platform/extensionManagement/common/extensionGalleryManifest.js';
import { IRemoteAuthorityResolverService, type ResolverResult } from '../platform/remote/common/remoteAuthorityResolver.js';
import { IMainProcessService } from '../platform/ipc/common/mainProcessService.js';
import { REVIEW_DESKTOP_CHANNEL } from './common/reviewDesktopBootstrap.js';
import { isReviewRemoteAuthority } from './services/remote/reviewRemoteAuthority.js';
import { reloadWhenOnline, reviewWindowAuthorityResolver, reviewWindowHosts } from './services/remote/reviewWindowAuthorityResolver.js';
import { ReviewSourceWindowHostState } from './services/remote/reviewSourceWindowHostState.js';
import { IHostService } from '../workbench/services/host/browser/host.js';
import { DesktopMain } from '../workbench/electron-browser/desktop.main.js';
import type { INativeWindowConfiguration } from '../platform/window/common/window.js';
import type { WorkspaceService } from '../workbench/services/configuration/browser/configurationService.js';
import { isReviewSourceTitle, REVIEW_SOURCE_TITLE_KEY, reviewSourceWindowConfiguration, type ReviewSourceWindowConfiguration } from './services/configuration/reviewSourceWindowConfiguration.js';

let sourceWindow: ReviewSourceWindowConfiguration<WorkspaceService> | undefined;

class NavigatorDesktopMain extends DesktopMain {
	protected override async createWorkspaceService(...args: Parameters<DesktopMain['createWorkspaceService']>): Promise<WorkspaceService> {
		const [, , , , , , , logService] = args;
		sourceWindow = reviewSourceWindowConfiguration(await super.createWorkspaceService(...args), logService);
		return sourceWindow.service;
	}
}

export function main(configuration: INativeWindowConfiguration): Promise<void> {
	return new NavigatorDesktopMain(configuration).open();
}

class NavigatorDefaults {
	constructor(@IStorageService storage: IStorageService) {
		// Use VS Code's own Hide Accounts preference; users can show it again.
		const key = AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY;
		if (storage.get(key, StorageScope.PROFILE) === undefined) {
			storage.store(key, false, StorageScope.PROFILE, StorageTarget.USER);
		}
		const title = storage.getObject(REVIEW_SOURCE_TITLE_KEY, StorageScope.WORKSPACE);
		if (isReviewSourceTitle(title)) sourceWindow?.setTitle(title);
	}
}

registerWorkbenchContribution2('review.navigator.defaults', NavigatorDefaults, WorkbenchPhase.BlockStartup);
registerWorkbenchContribution2(ReviewSourceWindowHostState.ID, ReviewSourceWindowHostState, WorkbenchPhase.BlockRestore);

class NavigatorExtensionService extends NativeExtensionService {
	private readonly windowHosts = this._instantiationService.invokeFunction((accessor) => reviewWindowHosts(accessor.get(IMainProcessService).getChannel(REVIEW_DESKTOP_CHANNEL)));
	protected override readonly _remoteAuthorityResolverService = this._instantiationService.invokeFunction((accessor) =>
		reviewWindowAuthorityResolver(accessor.get(IRemoteAuthorityResolverService), this.windowHosts));
	private retrying = false;

	protected override async _resolveAuthority(remoteAuthority: string): Promise<ResolverResult> {
		if (!isReviewRemoteAuthority(remoteAuthority)) return super._resolveAuthority(remoteAuthority);
		try {
			return await this._remoteAuthorityResolverService.resolveAuthority(remoteAuthority);
		} catch (error) {
			if (!this.retrying) {
				this.retrying = true;
				const host = this._instantiationService.invokeFunction((accessor) => accessor.get(IHostService));
				this._register(reloadWhenOnline(this.windowHosts, remoteAuthority.slice('whiteboard+'.length), () => void host.reload()));
			}
			throw error;
		}
	}
}

registerSingleton(IExtensionService, NavigatorExtensionService, InstantiationType.Eager);
registerSingleton(IExtensionManagementServerService, ReviewExtensionManagementServerService, InstantiationType.Delayed);
registerSingleton(IExtensionGalleryManifestService, ReviewExtensionGalleryManifestService, InstantiationType.Eager);

CommandsRegistry.registerCommand('review.action.setSourceTitle', (accessor, title: unknown) => {
	if (!isReviewSourceTitle(title)) return;
	const value = { side: title.side, title: title.title, ...(title.alias && { alias: title.alias }) };
	accessor.get(IStorageService).store(REVIEW_SOURCE_TITLE_KEY, value, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	sourceWindow?.setTitle(value);
});

CommandsRegistry.registerCommand('review.action.showReferencesInSource', async (accessor, resource: string, lineNumber: number, column: number) => {
	const editorService = accessor.get(IEditorService);
	const references = accessor.get(ILanguageFeaturesService).referenceProvider;
	const commandService = accessor.get(ICommandService);
	const uri = URI.parse(resource);
	const position = new Position(lineNumber, column);
	const pane = await editorService.openEditor({
		resource: uri,
		options: { selection: { startLineNumber: lineNumber, startColumn: column }, pinned: true },
	});
	const editor = getCodeEditor(pane?.getControl());
	if (!editor?.hasModel()) throw new Error('Could not open the source file for references.');
	const model = editor.getModel();
	if (!references.has(model)) {
		await new Promise<void>((resolve, reject) => {
			const listener = references.onDidChange(() => {
				if (references.has(model)) { listener.dispose(); clearTimeout(timeout); resolve(); }
			});
			const timeout = setTimeout(() => { listener.dispose(); reject(new Error('No reference provider became available for this file.')); }, 30_000);
			if (references.has(model)) { listener.dispose(); clearTimeout(timeout); resolve(); }
		});
	}
	editor.setPosition(position);
	editor.focus();
	await commandService.executeCommand('editor.action.goToReferences', new SymbolNavigationAnchor(model, editor.getPosition()));
});

Registry.as<IQuickAccessRegistry>(QuickAccessExtensions.Quickaccess).registerQuickAccessProvider({
	ctor: CommandsQuickAccessProvider,
	prefix: CommandsQuickAccessProvider.PREFIX,
	contextKey: 'inCommandsPicker',
	helpEntries: [{ description: 'Show and Run Commands', commandId: ShowAllCommandsAction.ID }],
});
registerAction2(ShowAllCommandsAction);
registerSingleton(IChatAgentService, ChatAgentService, InstantiationType.Delayed);

registerSingleton(INotebookService, NotebookService, InstantiationType.Delayed);
registerSingleton(INotebookEditorService, NotebookEditorWidgetService, InstantiationType.Delayed);
registerSingleton(INotebookEditorModelResolverService, NotebookModelResolverServiceImpl, InstantiationType.Delayed);
registerSingleton(ISCMService, SCMService, InstantiationType.Delayed);

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerDefaultConfigurations([{
	overrides: {
		'telemetry.telemetryLevel': 'off',
		'chat.disableAIFeatures': true,
		'security.workspace.trust.enabled': false,
		'workbench.startupEditor': 'none',
		'window.autoDetectColorScheme': reviewConfigurationDefaults['window.autoDetectColorScheme'],
		'workbench.colorTheme': reviewConfigurationDefaults['workbench.colorTheme'],
		'workbench.preferredDarkColorTheme': reviewConfigurationDefaults['workbench.preferredDarkColorTheme'],
		'workbench.preferredLightColorTheme': reviewConfigurationDefaults['workbench.preferredLightColorTheme'],
		...reviewSourceWindowDefaults,
	},
}]);
