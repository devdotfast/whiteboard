import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import type { IWebviewViewService } from "../../../../workbench/contrib/webviewView/browser/webviewViewService.js";
import { reviewRemoteWebviewViewService } from "./reviewRemoteWebviewViewService.js";

test("webview views are refused, logged once", () => {
	const { warnings, refusals: r } = refusals();
	const calls: string[] = [];
	const views = reviewRemoteWebviewViewService({ register: () => calls.push("register") } as unknown as IWebviewViewService, r);
	for (let i = 0; i < 2; i++) assert.throws(() => views.register("probe.view", { resolve: async () => { } }), /^Error: Not available for an extension on wb-test-a: showing webviews\.$/);
	assert.deepEqual(calls, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused showing webviews`]);
});
