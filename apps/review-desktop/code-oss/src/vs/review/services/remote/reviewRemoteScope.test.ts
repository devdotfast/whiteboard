import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { Emitter, Event } from "../../../base/common/event.js";
import { URI } from "../../../base/common/uri.js";
import { Range } from "../../../editor/common/core/range.js";
import { SymbolKind, type DocumentSymbol, type Hover } from "../../../editor/common/languages.js";
import { ILanguageFeatureDebounceService } from "../../../editor/common/services/languageFeatureDebounce.js";
import { ILanguageFeaturesService } from "../../../editor/common/services/languageFeatures.js";
import { LanguageFeaturesService } from "../../../editor/common/services/languageFeaturesService.js";
import { IModelService } from "../../../editor/common/services/model.js";
import { ITextModelService } from "../../../editor/common/services/resolverService.js";
import { IOutlineModelService, OutlineModelService } from "../../../editor/contrib/documentSymbols/browser/outlineModel.js";
import { CommandsRegistry, ICommandService } from "../../../platform/commands/common/commands.js";
import { IFileService } from "../../../platform/files/common/files.js";
import { SyncDescriptor } from "../../../platform/instantiation/common/descriptors.js";
import { InstantiationService } from "../../../platform/instantiation/common/instantiationService.js";
import { ServiceCollection } from "../../../platform/instantiation/common/serviceCollection.js";
import { ILogService, NullLogService } from "../../../platform/log/common/log.js";
import { MarkerService } from "../../../platform/markers/common/markerService.js";
import { IMarkerService, MarkerSeverity } from "../../../platform/markers/common/markers.js";
import type { IWorkspaceSymbol } from "../../../workbench/contrib/search/common/search.js";
import { IExtensionService } from "../../../workbench/services/extensions/common/extensions.js";
import type { IRemoteAuthorityResolverService } from "../../../platform/remote/common/remoteAuthorityResolver.js";
import { reviewRemoteAuthority } from "./reviewRemoteAuthority.js";
import {
	ReviewRemoteWorkspace,
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

test("a host's vscode.executeHoverProvider and executeDocumentSymbolProvider run on that host's providers, and its workspace symbols are in its own files", async () => {
	const { JSDOM } = createRequire(import.meta.url)("jsdom");
	const dom = new JSDOM("<html><body></body></html>");
	for (const key of ["window", "document", "HTMLElement", "HTMLCanvasElement", "Node", "MutationObserver", "Element", "navigator", "customElements", "UIEvent", "MouseEvent", "KeyboardEvent", "FocusEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
	dom.window.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { } }) as never;
	registerHooks({ load: (url, context, next) => (url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context)) });
	await import("../../../editor/contrib/hover/browser/getHover.js");
	await import("../../../editor/contrib/documentSymbols/browser/documentSymbols.js");
	const model = { id: "a", uri: onA, getLanguageId: () => "typescript", getVersionId: () => 1, isTooLargeForSyncing: () => false };
	const remote = new LanguageFeaturesService();
	const laptopFeatures = new LanguageFeaturesService();
	const range = new Range(1, 1, 1, 5);
	remote.hoverProvider.register({ language: "typescript" }, { provideHover: () => ({ range, contents: [{ value: "from host A" }] }) });
	laptopFeatures.hoverProvider.register("*", { provideHover: () => ({ range, contents: [{ value: "the window's" }] }) });
	const symbol = (name: string) => ({ name, detail: "", kind: SymbolKind.Function, tags: [], range, selectionRange: range });
	remote.documentSymbolProvider.register({ language: "typescript" }, { provideDocumentSymbols: () => [symbol("fromHostA")] });
	laptopFeatures.documentSymbolProvider.register("*", { provideDocumentSymbols: () => [symbol("theWindows")] });
	CommandsRegistry.registerCommand("_executeWorkspaceSymbolProvider", () => [onA, onB, laptop].map((uri) => ({ ...symbol(uri.toString()), location: { uri, range } })));
	const activated: string[] = [];
	const window = new ServiceCollection(
		[ILogService, new NullLogService()],
		[ILanguageFeaturesService, laptopFeatures],
		[IModelService, { getModel: (uri: URI) => (uri.toString() === onA.toString() ? model : null), onModelRemoved: Event.None }],
		[ITextModelService, { createModelReference: async () => ({ object: { textEditorModel: model }, dispose() { } }) }],
		[ILanguageFeatureDebounceService, { for: () => ({ get: () => 0, update: () => 0, default: () => 0 }) }],
		[IOutlineModelService, new SyncDescriptor(OutlineModelService)],
		[IMarkerService, new MarkerService()],
		[IFileService, { onDidFilesChange: Event.None, onDidRunOperation: Event.None }],
		[IExtensionService, { activateByEvent: async (event: string) => { activated.push(`window ${event}`); } }],
	);
	const parent = new InstantiationService(window, true);
	const scope = parent.createChild(parent.invokeFunction((accessor) => reviewRemoteScope({
		authority: A,
		extensions: [],
		activate: async (event) => { activated.push(`host ${event}`); },
		languageFeatures: remote,
		workspace: new ReviewRemoteWorkspace("w"),
		resolver: {} as IRemoteAuthorityResolverService,
	}, accessor)));

	const commands = scope.invokeFunction((accessor) => accessor.get(ICommandService));

	const hovers = await commands.executeCommand<Hover[]>("_executeHoverProvider", onA, { lineNumber: 1, column: 2 });
	const symbols = await commands.executeCommand<DocumentSymbol[]>("_executeDocumentSymbolProvider", onA);
	const workspaceSymbols = await commands.executeCommand<IWorkspaceSymbol[]>("_executeWorkspaceSymbolProvider", "");

	assert.deepEqual(hovers?.map((hover) => hover.contents.map((content) => content.value)), [["from host A"]]);
	assert.deepEqual(symbols?.map((item) => item.name), ["fromHostA"]);
	assert.deepEqual(workspaceSymbols?.map((item) => item.location.uri.toString()), [onA.toString()]);
	assert.deepEqual(activated, ["_executeHoverProvider", "_executeDocumentSymbolProvider", "_executeWorkspaceSymbolProvider"].map((id) => `host onCommand:${id}`));
});
