import assert from "node:assert/strict";
import test from "node:test";
import { Emitter, Event } from "../../../base/common/event.js";
import { URI } from "../../../base/common/uri.js";
import { IModelService } from "../../../editor/common/services/model.js";
import { MarkerService } from "../../../platform/markers/common/markerService.js";
import { MarkerSeverity } from "../../../platform/markers/common/markers.js";
import type { IRemoteAuthorityResolverService } from "../../../platform/remote/common/remoteAuthorityResolver.js";
import { IBulkEditService } from "../../../editor/browser/services/bulkEditService.js";
import { ITextModelService } from "../../../editor/common/services/resolverService.js";
import { IConfigurationService } from "../../../platform/configuration/common/configuration.js";
import { IEnvironmentService } from "../../../platform/environment/common/environment.js";
import { IFileService } from "../../../platform/files/common/files.js";
import { IInstantiationService, type ServiceIdentifier } from "../../../platform/instantiation/common/instantiation.js";
import { InstantiationService } from "../../../platform/instantiation/common/instantiationService.js";
import { ServiceCollection } from "../../../platform/instantiation/common/serviceCollection.js";
import { ILabelService } from "../../../platform/label/common/label.js";
import { ILanguagePackService } from "../../../platform/languagePacks/common/languagePacks.js";
import { ILoggerService, ILogService } from "../../../platform/log/common/log.js";
import { IMarkerService } from "../../../platform/markers/common/markers.js";
import { IOpenerService } from "../../../platform/opener/common/opener.js";
import { IRequestService } from "../../../platform/request/common/request.js";
import { ISecretStorageService } from "../../../platform/secrets/common/secrets.js";
import { IStorageService } from "../../../platform/storage/common/storage.js";
import { ITelemetryService } from "../../../platform/telemetry/common/telemetry.js";
import { IUriIdentityService } from "../../../platform/uriIdentity/common/uriIdentity.js";
import { IUserActivityService } from "../../../workbench/services/userActivity/common/userActivityService.js";
import { IWorkspaceTrustRequestService } from "../../../platform/workspace/common/workspaceTrust.js";
import { INotificationService } from "../../../platform/notification/common/notification.js";
import { IProgressService } from "../../../platform/progress/common/progress.js";
import { IExtensionStatusBarItemService } from "../../../workbench/api/browser/statusBarExtensionPoint.js";
import { IExtensionsWorkbenchService } from "../../../workbench/contrib/extensions/common/extensions.js";
import { IWorkbenchExtensionEnablementService } from "../../../workbench/services/extensionManagement/common/extensionManagement.js";
import { MainThreadBulkEdits } from "../../../workbench/api/browser/mainThreadBulkEdits.js";
import { MainThreadClipboard } from "../../../workbench/api/browser/mainThreadClipboard.js";
import { MainThreadDownloadService } from "../../../workbench/api/browser/mainThreadDownloadService.js";
import { MainThreadFileSystem } from "../../../workbench/api/browser/mainThreadFileSystem.js";
import { MainThreadLoggerService } from "../../../workbench/api/browser/mainThreadLogService.js";
import { MainThreadWindow } from "../../../workbench/api/browser/mainThreadWindow.js";
import { IWebviewViewService } from "../../../workbench/contrib/webviewView/browser/webviewViewService.js";
import { IDecorationsService } from "../../../workbench/services/decorations/common/decorations.js";
import { IEditorGroupsService } from "../../../workbench/services/editor/common/editorGroupsService.js";
import { IEditorService } from "../../../workbench/services/editor/common/editorService.js";
import { IWorkbenchEnvironmentService } from "../../../workbench/services/environment/common/environmentService.js";
import type { IExtHostContext } from "../../../workbench/services/extensions/common/extHostCustomers.js";
import { IExtensionService } from "../../../workbench/services/extensions/common/extensions.js";
import { IHostService } from "../../../workbench/services/host/browser/host.js";
import { ITextFileService } from "../../../workbench/services/textfile/common/textfiles.js";
import { IWorkingCopyFileService } from "../../../workbench/services/workingCopy/common/workingCopyFileService.js";
import { IWebviewWorkbenchServiceId } from "./guard/reviewRemoteWebviewWorkbenchService.js";
import { ReviewRemoteTextEditors } from "./guard/reviewRemoteTextEditors.js";
import { ICodeEditorService } from "../../../editor/browser/services/codeEditorService.js";
import { ILanguageStatusService } from "../../../workbench/services/languageStatus/common/languageStatusService.js";
import {
	ReviewRemoteWorkspace,
	reviewRemoteAuthority,
	reviewRemoteMarkerService,
	reviewRemoteModelService,
	reviewRemoteResolver,
	reviewRemoteScope,
} from "./reviewRemoteScope.js";

const A = "whiteboard+aaaa-1111";
const B = "whiteboard+bbbb-2222";
const onA = URI.parse(`vscode-remote://${A}/home/dev/proj/b.ts`);
const onB = URI.parse(`vscode-remote://${B}/home/dev/proj/b.ts`);
const laptop = URI.file("/home/dev/proj/b.ts");

test("the authority is whiteboard+<serverId> in lower case, and an id that is not one is refused", () => {
	assert.equal(reviewRemoteAuthority("3480C31A-77f0-4d6e-9a53-1b2c3d4e5f60"), "whiteboard+3480c31a-77f0-4d6e-9a53-1b2c3d4e5f60");
	assert.equal(URI.parse(`vscode-remote://${reviewRemoteAuthority("ABC-1")}/x`).authority, "whiteboard+abc-1");
	for (const id of ["", "a/b", "a@b", "a:1", "a b", "wb+x"]) assert.equal(reviewRemoteAuthority(id), undefined, id);
});

test("a host's model service shows it only its own remote models", () => {
	const models = [onA, onB, laptop].map((uri) => ({ uri }));
	const added = new Emitter<{ uri: URI }>();
	const base = {
		getModels: () => models,
		getModel: (uri: URI) => models.find((model) => model.uri.toString() === uri.toString()) ?? null,
		onModelAdded: added.event,
		onModelRemoved: new Emitter().event,
		onModelLanguageChanged: new Emitter().event,
		createModel: () => "the window's",
	} as unknown as IModelService;
	const scoped = reviewRemoteModelService(base, A);

	assert.deepEqual(scoped.getModels().map((model) => model.uri.toString()), [onA.toString()]);
	assert.equal(scoped.getModel(onA)?.uri.toString(), onA.toString());
	assert.equal(scoped.getModel(onB), null);
	assert.equal(scoped.getModel(laptop), null);
	assert.equal((scoped as unknown as { createModel(): string }).createModel(), "the window's");

	const seen: string[] = [];
	const listener = scoped.onModelAdded((model) => seen.push(model.uri.toString()));
	for (const uri of [onB, laptop, onA]) added.fire({ uri });
	listener.dispose();
	assert.deepEqual(seen, [onA.toString()]);
});

test("a host's markers use its own owner names, and it sees and changes markers of its own files only", () => {
	const markers = new MarkerService();
	const a = reviewRemoteMarkerService(markers, A);
	const b = reviewRemoteMarkerService(markers, B);
	const marker = (message: string) => ({ message, severity: MarkerSeverity.Error, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 });
	markers.changeOne("typescript", laptop, [marker("laptop")]);
	a.changeOne("typescript", onA, [marker("a")]);
	b.changeOne("typescript", onB, [marker("b")]);
	a.changeOne("typescript", laptop, [marker("a on the laptop")]);
	a.changeOne("typescript", onB, [marker("a on b")]);
	assert.deepEqual(markers.read({ resource: laptop }).map((m) => m.message), ["laptop"]);
	assert.deepEqual(markers.read({ resource: onB }).map((m) => m.message), ["b"]);

	const changes: string[][] = [];
	const listener = b.onMarkerChanged((resources) => changes.push(resources.map(String)));
	a.changeAll("typescript", []);
	listener.dispose();

	assert.deepEqual(markers.read().map((m) => [m.owner, m.message]).sort(), [
		["typescript", "laptop"],
		[`${B}/typescript`, "b"],
	]);
	assert.deepEqual(b.read({ owner: "typescript" }).map((m) => m.message), ["b"]);
	assert.deepEqual(b.read({ resource: laptop }), []);
	assert.deepEqual(changes, [], "b is not told about a's files");
	markers.dispose();
});

test("a host's resolver answers for its own authority with a fresh address, and leaves others to the window", async () => {
	let port = 4000;
	const base = {
		resolveAuthority: async (name: string) => ({ authority: { authority: `window:${name}` } }),
		getConnectionData: () => "window",
	} as unknown as IRemoteAuthorityResolverService;
	const resolver = reviewRemoteResolver(base, A, async () => ({
		connectTo: { type: 0, host: "127.0.0.1", port: port++ } as never,
		connectionToken: "secret",
	}));

	assert.equal(resolver.getConnectionData(A), null);
	assert.equal(((await resolver.resolveAuthority(A)).authority.connectTo as { port: number }).port, 4000);
	const second = await resolver.resolveAuthority(A);
	assert.deepEqual([second.authority.authority, (second.authority.connectTo as { port: number }).port, second.authority.connectionToken], [A, 4001, "secret"]);
	assert.equal((resolver.getConnectionData(A)?.connectTo as { port: number }).port, 4001);
	assert.equal((await resolver.resolveAuthority(B)).authority.authority, `window:${B}`);
	assert.equal(resolver.getConnectionData(B), "window");
});

test("a host's workspace holds each root while any caller holds it", () => {
	const workspace = new ReviewRemoteWorkspace("whiteboard-remote-a");
	const events: string[] = [];
	workspace.onDidChangeWorkspaceFolders((e) => events.push(`+${e.added.map((f) => f.uri.path)} -${e.removed.map((f) => f.uri.path)}`));
	const root = URI.parse(`vscode-remote://${A}/home/dev/proj`);
	const other = URI.parse(`vscode-remote://${A}/home/dev/other`);
	const first = workspace.add(root);
	const second = workspace.add(root);
	const third = workspace.add(other);
	assert.deepEqual(workspace.getWorkspace().folders.map((f) => [f.uri.path, f.index]), [["/home/dev/proj", 0], ["/home/dev/other", 1]]);
	assert.equal(workspace.getWorkspaceFolder(onA)?.uri.path, "/home/dev/proj");
	assert.equal(workspace.isInsideWorkspace(onB), false);
	first.dispose();
	first.dispose();
	assert.equal(workspace.getWorkspace().folders.length, 2);
	second.dispose();
	assert.deepEqual(workspace.getWorkspace().folders.map((f) => [f.uri.path, f.index]), [["/home/dev/other", 0]]);
	third.dispose();
	assert.deepEqual(events, ["+/home/dev/proj -", "+/home/dev/other -", "+ -/home/dev/proj", "+ -/home/dev/other"]);
	workspace.dispose();
});

test("a host's main-thread peers are created with the guarded services", async () => {
	const reached: string[] = [];
	const warnings: string[] = [];
	const record = (name: string) => async (...args: unknown[]) => { reached.push(`${name} ${args[0]}`); return { value: { toString: () => "text" } }; };
	const window = new ServiceCollection();
	const fake = <T>(id: ServiceIdentifier<T>, value: object = {}) => window.set(id, value as T);
	fake(ILogService, { warn: (message: string) => warnings.push(message), trace() { } });
	fake(IFileService, { readFile: record("readFile"), writeFile: record("writeFile"), listCapabilities: () => [], onDidChangeFileSystemProviderRegistrations: Event.None, onDidChangeFileSystemProviderCapabilities: Event.None });
	fake(IOpenerService, { open: record("open") });
	fake(IHostService, { onDidChangeFocus: Event.None, onDidChangeActiveWindow: Event.None });
	fake(IUserActivityService, { onDidChangeIsActive: Event.None });
	fake(ILoggerService, { createLogger: record("createLogger"), onDidChangeLogLevel: Event.None });
	fake(ITextFileService, { files: {}, untitled: {} });
	fake(IUriIdentityService, { asCanonicalUri: (uri: URI) => uri });
	fake(ILanguageStatusService, { addStatus: record("addStatus") });
	fake(ICodeEditorService, { listCodeEditors: () => [] });
	for (const id of [IExtensionStatusBarItemService, INotificationService, IProgressService, IExtensionsWorkbenchService, IWorkbenchExtensionEnablementService, IModelService, IMarkerService, ITextModelService, IWorkingCopyFileService, IEditorGroupsService, IEditorService, IConfigurationService, IStorageService, ISecretStorageService, IWebviewWorkbenchServiceId, IWebviewViewService, ILabelService, IDecorationsService, IWorkspaceTrustRequestService, IRequestService, ILanguagePackService, ITelemetryService, IExtensionService, IWorkbenchEnvironmentService, IEnvironmentService, IBulkEditService] as ServiceIdentifier<unknown>[]) {
		if (!window.has(id)) fake(id);
	}
	const parent = new InstantiationService(window, true);
	const scope = parent.createChild(parent.invokeFunction((accessor) => reviewRemoteScope({
		authority: A,
		name: () => "wb-test-a",
		extensions: [],
		activate: async () => { },
		languageFeatures: {} as never,
		workspace: new ReviewRemoteWorkspace("w"),
		resolver: {} as IRemoteAuthorityResolverService,
		ownFiles: { copy: record("own copy"), writeFile: record("own writeFile"), listCapabilities: () => [] } as unknown as IFileService,
	}, accessor)));
	const context = { remoteAuthority: A, getProxy: () => ({ $acceptProviderInfos() { }, $onDidChangeWindowFocus() { } }) } as unknown as IExtHostContext;
	const peer = <T>(ctor: new (context: IExtHostContext, ...services: never[]) => T): T => scope.invokeFunction((accessor) => (accessor.get(IInstantiationService).createInstance as (ctor: unknown, context: IExtHostContext) => T)(ctor, context));
	const refused = /^Error: Not available for an extension on wb-test-a: /;
	const laptop = URI.file("/etc/hosts");

	await assert.rejects(peer(MainThreadFileSystem).$readFile(laptop), refused);
	await assert.rejects(peer(MainThreadFileSystem).$readFile(onB), refused);
	await peer(MainThreadFileSystem).$readFile(onA);
	await peer(MainThreadFileSystem).$copy(onA, onA.with({ path: "/home/dev/proj/copy.ts" }), { overwrite: false });
	await assert.rejects(peer(MainThreadFileSystem).$writeFile(laptop, undefined as never), refused);
	await assert.rejects(peer(MainThreadFileSystem).$copy(onA, onB, { overwrite: false }), refused);
	await assert.rejects(peer(MainThreadWindow).$openUri(URI.file("/System/Applications/Calculator.app"), undefined, {}), refused);
	await peer(MainThreadWindow).$openUri(URI.parse("https://example.com/"), undefined, {});
	await assert.rejects(peer(MainThreadClipboard).$readText(), refused);
	await assert.rejects(peer(MainThreadDownloadService).$download(URI.parse("https://example.com/"), laptop), refused);
	assert.equal(await peer(MainThreadBulkEdits).$tryApplyWorkspaceEdit({ value: { edits: [] } } as never), false);
	await assert.rejects(peer(MainThreadLoggerService).$createLogger(URI.file("/Users/me/.zshrc")), refused);
	await assert.rejects(peer(ReviewRemoteTextEditors).$tryShowTextDocument(laptop, {}), refused);
	await assert.rejects(peer(ReviewRemoteTextEditors).$tryApplyEdits(), refused);
	scope.invokeFunction((accessor) => accessor.get(ILanguageStatusService)).addStatus({ command: { id: "vscode.openFolder" } } as never);
	assert.deepEqual(reached, [`readFile ${onA}`, `own copy ${onA}`, "open https://example.com/"]);
	for (const kind of ["editing documents or files", "opening editors outside this remote", "showing language status items"])
		assert.ok(warnings.some((warning) => warning.includes(`refused ${kind}`)), kind);
});
