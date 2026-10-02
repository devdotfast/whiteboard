import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createRequire, registerHooks } from "node:module";
import { CancellationToken } from "../../base/common/cancellation.js";
import { Disposable } from "../../base/common/lifecycle.js";
import { Position } from "../../editor/common/core/position.js";
import { Range } from "../../editor/common/core/range.js";
import { LanguageFeaturesService } from "../../editor/common/services/languageFeaturesService.js";
import { URI } from "../../base/common/uri.js";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const dom = new JSDOM("<html><body></body></html>");
for (const key of ["window", "document", "HTMLElement", "HTMLCanvasElement", "Node", "MutationObserver", "Element", "navigator", "customElements", "UIEvent", "MouseEvent", "KeyboardEvent", "FocusEvent"] as const) {
	Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
dom.window.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { } }) as never;
registerHooks({ load(url, context, next) {
	return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context);
} });
const { ReviewLocalLanguageFeatures } = await import("./reviewLocalLanguageFeatures.js");

function event<T>() {
	const listeners = new Set<(value: T) => void>();
	return {
		event: (listener: (value: T) => void) => {
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
		fire(value: T) { for (const listener of [...listeners]) listener(value); },
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

function model(attached = false) {
	const changed = event<void>();
	const disposed = event<void>();
	let isDisposed = false;
	const text = "same pinned source";
	return {
		uri: URI.parse("review-api-source://review/src/file.ts?version=1"),
		isAttachedToEditor: () => attached,
		isDisposed: () => isDisposed,
		getVersionId: () => 1,
		getTextBuffer: () => text,
		getEOL: () => "\n",
		equalsTextBuffer: (other: string) => other === text,
		onDidChangeAttached: changed.event,
		onWillDispose: disposed.event,
		setAttached(value: boolean) { attached = value; changed.fire(); },
		dispose() { isDisposed = true; disposed.fire(); },
	} as any;
}

/** The window's code editor service as far as opening goes: later handlers first, then the workbench's own path to a source window. */
function codeEditors() {
	const handlers: ((input: any, source: unknown, sideBySide?: boolean) => Promise<unknown>)[] = [];
	const sourceWindows: string[] = [];
	const opened: { resource: string; selection: unknown }[] = [];
	return {
		sourceWindows, opened,
		service: { registerCodeEditorOpenHandler: (handler: any) => { handlers.unshift(handler); return Disposable.None; } },
		editors: { openEditor: async (input: any) => { opened.push({ resource: input.resource.toString(), selection: input.options?.selection }); return { getControl: () => ({ getEditorType: () => "vs.editor.ICodeEditor" }) }; } },
		async open(input: any) {
			for (const handler of handlers) {
				const editor = await handler(input, null);
				if (editor) return editor;
			}
			sourceWindows.push(input.resource.toString());
			return null;
		},
	};
}

function setup(input: ReturnType<typeof model> | ReturnType<typeof model>[]) {
	const sourceModels = Array.isArray(input) ? input : [input];
	const added = event<any>();
	const modelService = { getModels: () => sourceModels, onModelAdded: added.event, createModelReference: async () => { throw new Error("unexpected model reference"); } };
	const languages = Object.fromEntries(["hoverProvider", "definitionProvider", "typeDefinitionProvider", "implementationProvider", "referenceProvider"].map(key => [key, {
		register: () => Disposable.None,
		ordered: () => [],
	}])) as any;
	const local = {
		uri: URI.file("/project/src/file.ts"),
		isDisposed: () => false,
		getVersionId: () => 1,
		getTextBuffer: () => "same pinned source",
		getEOL: () => "\n",
		equalsTextBuffer: (other: string) => other === "same pinned source",
	};
	const opening = codeEditors();
	const service = new ReviewLocalLanguageFeatures(
		{ onDidChangeConnection: () => Disposable.None } as any,
		{ createModelReference: async (uri: URI) => ({ object: { textEditorModel: { ...local, uri } }, dispose() { } }) } as any,
		modelService as any,
		languages,
		{ activateByEvent: async () => undefined } as any,
		{} as any,
		{ files: { models: [], resolve: async () => undefined } } as any,
		{ onDidFilesChange: () => Disposable.None, exists: async () => true } as any,
		{ debug() { } } as any,
		{ host: async () => undefined } as any,
		opening.service as any,
		opening.editors as any,
	);
	return { service, sourceModel: sourceModels[0], sourceModels, local, opening };
}

function source(local: any) {
	let references = 1;
	let disposed = false;
	const disposal = deferred<void>();
	const release = () => {
		if (!disposed && --references === 0) { disposed = true; disposal.resolve(); }
	};
	const source = {
		identity: "identity",
		root: URI.file("/project"),
		reference: { object: { textEditorModel: local }, dispose() { } },
		retain() {
			if (disposed) return undefined;
			references++;
			let released = false;
			return { dispose() { if (!released) { released = true; release(); } } };
		},
		dispose: release,
		isDisposed: () => disposed,
		waitDisposed: () => disposal.promise,
	};
	return source;
}

test("cancellation while acquiring a review source releases the newly acquired native model", async (t) => {
	const setupResult = setup(model());
	t.after(() => setupResult.service.dispose());
	const acquisition = deferred<any>();
	const started = deferred<void>();
	const actualSource = source(setupResult.local);
	const internal = setupResult.service as any;
	internal.environment = async () => ({ rootPath: "/project", identity: "identity" });
	internal.acquire = async () => { started.resolve(); return acquisition.promise; };
	const token = { isCancellationRequested: false };
	const pending = internal.withSource(setupResult.sourceModel, new Position(1, 1), token, async () => "should not run");
	await started.promise;
	token.isCancellationRequested = true;
	acquisition.resolve(actualSource);
	assert.equal(await pending, undefined);
	assert.equal(actualSource.isDisposed(), true, "the canceled request drops both its temporary retain and detached owner");
});

test("detaching during an in-flight definition keeps its captured source until mapping completes", async (t) => {
	const setupResult = setup(model());
	t.after(() => setupResult.service.dispose());
	const acquisition = deferred<any>();
	const started = deferred<void>();
	const entered = deferred<void>();
	const acquired = source(setupResult.local);
	const internal = setupResult.service as any;
	internal.environment = async () => ({ rootPath: "/project", identity: "identity" });
	internal.acquire = async () => { started.resolve(); return acquisition.promise; };
	setupResult.sourceModel.setAttached(true);
	await started.promise;
	const mapping = deferred<string>();
	let capturedSource: unknown;
	const request = internal.withSource(setupResult.sourceModel, new Position(1, 1), { isCancellationRequested: false }, async (_local: unknown, _at: unknown, _review: unknown, captured: unknown) => {
		assert.equal(captured, acquired);
		capturedSource = captured;
		entered.resolve();
		return mapping.promise;
	});
	acquisition.resolve(acquired);
	await entered.promise;
	setupResult.sourceModel.setAttached(false);
	assert.equal(acquired.isDisposed(), false, "the request retain survives detachment and source-map eviction");
	const locations = await internal.reviewLocations(setupResult.sourceModel, [{ uri: URI.file("/project/src/target.ts") }], { isCancellationRequested: false }, capturedSource);
	assert.equal(locations[0].uri.scheme, "review-api-source", "definition mapping uses the source retained by this request after map eviction");
	mapping.resolve("mapped result");
	assert.equal(await request, "mapped result");
	assert.equal(acquired.isDisposed(), true, "mapping completion releases the final source reference");
});

test("hundreds of unattached pinned models allocate no native source models; detaching releases the visible model", async (t) => {
	const setupResult = setup(Array.from({ length: 800 }, () => model()));
	t.after(() => setupResult.service.dispose());
	const acquired = source(setupResult.local);
	const internal = setupResult.service as any;
	internal.environment = async () => ({ rootPath: "/project", identity: "identity" });
	let acquireCount = 0;
	internal.acquire = async () => { acquireCount++; return acquired; };
	assert.equal(acquireCount, 0, "the pinned comparison is not eagerly resolved into 800 native working copies");
	setupResult.sourceModel.setAttached(true);
	await internal.localSource(setupResult.sourceModel, true);
	assert.equal(acquireCount, 1);
	setupResult.sourceModel.setAttached(false);
	await acquired.waitDisposed();
	assert.equal(acquired.isDisposed(), true);
});

test("disposing a review model or the service releases its warm native source", async (t) => {
	for (const disposeOwner of ["model", "service"] as const) {
		const result = setup(model());
		const acquired = source(result.local);
		const internal = result.service as any;
		internal.environment = async () => ({ rootPath: "/project", identity: "identity" });
		internal.acquire = async () => acquired;
		result.sourceModel.setAttached(true);
		await internal.localSource(result.sourceModel, true);
		if (disposeOwner === "model") result.sourceModel.dispose();
		else result.service.dispose();
		await acquired.waitDisposed();
		assert.equal(acquired.isDisposed(), true, `${disposeOwner} disposal releases the working copy`);
		result.service.dispose();
	}
});

const SERVER_ID = "6F23D55B-8446-437e-afd6-ad3a40eecc4c";
const AUTHORITY = "whiteboard+6f23d55b-8446-437e-afd6-ad3a40eecc4c";
const ROOT = "/home/dev/repo/.git/dev-fast/reviews/r/head/c";
const remoteUri = (path: string, authority = AUTHORITY) => URI.from({ scheme: "vscode-remote", authority, path });

/** A review of `src/file.ts` whose checkout is on a remote host. */
function remoteSetup(connect?: () => Promise<unknown>) {
	const window = new LanguageFeaturesService();
	const remote = new LanguageFeaturesService();
	const roots: string[] = [];
	const asked: string[] = [];
	const activated: string[] = [];
	const windowActivations: string[] = [];
	const host = {
		authority: AUTHORITY,
		languageFeatures: remote,
		addRoot: async (root: URI) => { roots.push(root.toString()); return Disposable.None; },
		activateByEvent: async (event: string) => { activated.push(event); },
	};
	const text = "same pinned source";
	const textModel = (uri: URI) => ({
		uri, isDisposed: () => false, getVersionId: () => 1, getTextBuffer: () => text, getEOL: () => "\n",
		equalsTextBuffer: (other: string) => other === text, getLanguageId: () => "typescript",
		isTooLargeForSyncing: () => false, onDidChangeContent: () => Disposable.None,
	});
	const review = model(true);
	const opening = codeEditors();
	const service = new ReviewLocalLanguageFeatures(
		{ onDidChangeConnection: () => Disposable.None } as any,
		{ createModelReference: async (uri: URI) => ({ object: { textEditorModel: textModel(uri) }, dispose() { } }) } as any,
		{ getModels: () => [], onModelAdded: () => Disposable.None } as any,
		window,
		{ activateByEvent: async (event: string) => { windowActivations.push(event); } } as any,
		{ addFolders: async () => { throw new Error("a remote root never enters the window's workspace"); } } as any,
		{ files: { models: [], resolve: async () => undefined } } as any,
		{ onDidFilesChange: () => Disposable.None, exists: async () => true } as any,
		{ debug() { }, warn() { } } as any,
		{ host: async (serverId: string) => { asked.push(serverId); return connect ? connect() : host; } } as any,
		opening.service as any,
		opening.editors as any,
	);
	const internal = service as any;
	internal.environment = async () => ({ remoteRootPath: ROOT, identity: "hash", serverId: SERVER_ID });
	return { service, internal, review, window, remote, roots, asked, activated, windowActivations, opening };
}

test("a remote review is rooted on its host and asks that host's registry, never the window's", async (t) => {
	const { service, internal, review, window, remote, roots, asked, activated, windowActivations } = remoteSetup();
	t.after(() => service.dispose());
	let windowAsked = 0;
	// The laptop's TypeScript matches remote models by language in the window's registry.
	window.hoverProvider.register({ language: "typescript" }, { provideHover: () => { windowAsked++; return { range: new Range(1, 1, 1, 5), contents: [{ value: "1" }] }; } });
	remote.hoverProvider.register({ language: "typescript" }, { provideHover: () => ({ range: new Range(1, 1, 1, 5), contents: [{ value: "42" }] }) });
	const hover = await internal.hover(review, new Position(1, 2), CancellationToken.None);
	assert.deepEqual(hover.contents.map((content: { value: string }) => content.value), ["42"]);
	assert.equal(windowAsked, 0);
	assert.deepEqual(asked, [SERVER_ID]);
	assert.deepEqual(roots, [remoteUri(ROOT).toString()]);
	assert.deepEqual(activated, ["onLanguage:typescript", "onReviewWorkspaceLanguage:typescript"]);
	assert.deepEqual(windowActivations, []);
});

test("a remote hover is untrusted, and a command link it carries is dropped rather than run in the window", async (t) => {
	const { service, internal, review, remote } = remoteSetup();
	t.after(() => service.dispose());
	remote.hoverProvider.register({ language: "typescript" }, { provideHover: () => ({
		range: new Range(1, 1, 1, 5),
		contents: [{ value: "**42** [restart](command:workbench.action.reloadWindow) <a href=\"command:x\">x</a> [docs](https://example.com)", isTrusted: true, supportHtml: true }],
	}) });
	const [content] = (await internal.hover(review, new Position(1, 2), CancellationToken.None)).contents;
	assert.equal(content.isTrusted, false);
	assert.equal(content.supportHtml, false);
	assert.doesNotMatch(content.value, /\(command:/, "the markdown link is its label");
	assert.match(content.value, /\\<a href/, "the HTML is inert text");
	assert.match(content.value, /42/);
	assert.match(content.value, /\(https:\/\/example\.com\)/);
});

test("a remote definition inside the review's repository maps to the review's file; one outside stays on its host", async (t) => {
	const { service, internal, review, remote } = remoteSetup();
	t.after(() => service.dispose());
	const range = new Range(1, 7, 1, 13);
	const library = remoteUri("/usr/lib/node_modules/typescript/lib/lib.es5.d.ts");
	remote.definitionProvider.register({ language: "typescript" }, { provideDefinition: () => [
		{ uri: remoteUri(`${ROOT}/src/a.ts`), range },
		{ uri: library, range },
		{ uri: URI.file(`${ROOT}/src/a.ts`), range },
		{ uri: remoteUri(`${ROOT}/src/a.ts`, "whiteboard+b563e17e-6f4f-4552-968e-12c38d75a6ab"), range },
	] });
	const locations = await internal.locations(review, new Position(1, 2), CancellationToken.None, "definition");
	assert.deepEqual(locations.map((location: { uri: URI }) => location.uri.toString()), [
		review.uri.with({ path: "/src/a.ts" }).toString(),
		library.toString(),
	]);
});

test("a hover for a review whose host is not connected resolves empty within 5 s, and the next hover asks again", async (t) => {
	mock.timers.enable({ apis: ["setTimeout"] });
	t.after(() => mock.timers.reset());
	const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

	const offline = remoteSetup(async () => undefined);
	t.after(() => offline.service.dispose());
	assert.equal(await offline.internal.hover(offline.review, new Position(1, 2), CancellationToken.None), undefined);
	assert.equal(await offline.internal.hover(offline.review, new Position(1, 2), CancellationToken.None), undefined);
	assert.deepEqual(offline.asked, [SERVER_ID, SERVER_ID]);

	const hung = { remote: new LanguageFeaturesService() };
	hung.remote.hoverProvider.register({ language: "typescript" }, { provideHover: () => new Promise(() => { }) });
	const reconnecting = remoteSetup(async () => ({ authority: AUTHORITY, languageFeatures: hung.remote, addRoot: async () => Disposable.None, activateByEvent: () => new Promise(() => { }) }));
	const connecting = remoteSetup(() => new Promise(() => { }));
	for (const { service, internal, review } of [reconnecting, connecting]) {
		t.after(() => service.dispose());
		let settled = false;
		const hover = internal.hover(review, new Position(1, 2), CancellationToken.None).finally(() => { settled = true; });
		await flush();
		mock.timers.tick(4_999);
		await flush();
		assert.equal(settled, false);
		mock.timers.tick(1);
		assert.equal(await hover, undefined);
	}
});

test("a cached source is kept per host: the same review and path on another host is acquired again", async (t) => {
	const { service, internal, review } = remoteSetup();
	t.after(() => service.dispose());
	const acquired: string[] = [];
	internal.acquire = async (_model: unknown, target: { root: URI }) => { acquired.push(target.root.authority); return source(undefined); };
	await internal.localSource(review);
	await internal.localSource(review);
	internal.environment = async () => ({ remoteRootPath: ROOT, identity: "hash", serverId: "b563e17e-6f4f-4552-968e-12c38d75a6ab" });
	await internal.localSource(review);
	assert.deepEqual(acquired, [AUTHORITY, "whiteboard+b563e17e-6f4f-4552-968e-12c38d75a6ab"]);
});

test("a remote review's in-repository definition opens its host's file at the range, never a source window; a laptop review's still does", async (t) => {
	const { service, internal, review, remote, opening } = remoteSetup();
	t.after(() => service.dispose());
	remote.definitionProvider.register({ language: "typescript" }, { provideDefinition: () => [{ uri: remoteUri(`${ROOT}/src/a.ts`), range: new Range(1, 7, 1, 13) }] });
	const [location] = await internal.locations(review, new Position(1, 2), CancellationToken.None, "definition");
	assert.equal(location.uri.scheme, "review-api-source", "results still name the review's own file");
	const selection = { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 7 };
	assert.ok(await opening.open({ resource: location.uri, options: { selection } }));
	assert.deepEqual(opening.opened, [{ resource: remoteUri(`${ROOT}/src/a.ts`).toString(), selection }]);
	assert.deepEqual(opening.sourceWindows, []);

	const laptop = setup(model(true));
	t.after(() => laptop.service.dispose());
	const internalLaptop = laptop.service as any;
	internalLaptop.environment = async () => ({ rootPath: "/project", identity: "identity" });
	internalLaptop.acquire = async () => source(laptop.local);
	await internalLaptop.localSource(laptop.sourceModel);
	const target = laptop.sourceModel.uri.with({ path: "/src/a.ts" });
	assert.equal(await laptop.opening.open({ resource: target, options: { selection } }), null);
	assert.deepEqual(laptop.opening.sourceWindows, [target.toString()]);
	assert.deepEqual(laptop.opening.opened, []);
});
