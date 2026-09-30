import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import type { IExtensionsWorkbenchService } from "../../../../workbench/contrib/extensions/common/extensions.js";
import { reviewRemoteExtensionsWorkbenchService } from "./reviewRemoteExtensionsWorkbenchService.js";

test("the laptop's extensions are not listed to a remote's error path, and none is installed or enabled; logged once", async () => {
	const { warnings, refusals: r } = refusals();
	const touched: string[] = [];
	const base = {
		queryLocal: async () => { touched.push("queryLocal"); return [{ identifier: { id: "laptop.ext" } }]; },
		install: async () => touched.push("install"),
		setEnablement: async () => touched.push("setEnablement"),
		isAutoUpdateEnabledFor: () => true,
	} as unknown as IExtensionsWorkbenchService;
	const extensions = reviewRemoteExtensionsWorkbenchService(base, r);
	assert.deepEqual(await extensions.queryLocal(), []);
	assert.deepEqual(await extensions.getExtensions([{ id: "ms-python.python" }], undefined as never), []);
	assert.throws(() => extensions.install("ms-python.python"), /managing the window's extensions/);
	assert.throws(() => extensions.setEnablement([], 0), /managing the window's extensions/);
	assert.deepEqual(touched, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused managing the window's extensions`]);
});
