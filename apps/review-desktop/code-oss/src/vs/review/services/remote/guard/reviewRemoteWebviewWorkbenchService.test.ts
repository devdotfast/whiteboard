import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import { createRequire, registerHooks } from "node:module";
import type { IWebviewWorkbenchService } from "../../../../workbench/contrib/webviewPanel/browser/webviewWorkbenchService.js";
import { IWebviewWorkbenchServiceId, reviewRemoteWebviewWorkbenchService } from "./reviewRemoteWebviewWorkbenchService.js";

test("webview panels are refused, logged once; revivers the peers register on start are dropped", () => {
	const { warnings, refusals: r } = refusals();
	const calls: string[] = [];
	const base = { openWebview: () => calls.push("open"), registerResolver: () => calls.push("resolver") } as unknown as IWebviewWorkbenchService;
	const webviews = reviewRemoteWebviewWorkbenchService(base, r);
	assert.throws(() => webviews.openWebview({} as never, "probe", "Probe", undefined, {}), /^Error: Not available for an extension on wb-test-a: showing webviews\.$/);
	assert.throws(() => webviews.revealWebview({} as never, 0, false), /showing webviews/);
	webviews.registerResolver({ canResolve: () => true, resolveWebview: async () => { } }).dispose();
	assert.deepEqual(calls, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused showing webviews`]);
});

test("the scope's identifier is the one the webview peers inject", async () => {
	const { JSDOM } = createRequire(import.meta.url)("jsdom");
	const dom = new JSDOM("<html><body></body></html>");
	for (const key of ["window", "document", "HTMLElement", "HTMLCanvasElement", "Node", "MutationObserver", "Element", "navigator", "customElements", "UIEvent", "MouseEvent", "KeyboardEvent", "FocusEvent"] as const) {
		Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
	}
	dom.window.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { } }) as never;
	registerHooks({ load(url, context, next) {
		return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context);
	} });
	const upstream = await import("../../../../workbench/contrib/webviewPanel/browser/webviewWorkbenchService.js");
	assert.equal(upstream.IWebviewWorkbenchService, IWebviewWorkbenchServiceId);
});
