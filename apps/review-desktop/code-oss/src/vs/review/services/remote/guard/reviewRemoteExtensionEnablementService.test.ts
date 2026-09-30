import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import type { IWorkbenchExtensionEnablementService } from "../../../../workbench/services/extensionManagement/common/extensionManagement.js";
import { reviewRemoteExtensionEnablementService } from "./reviewRemoteExtensionEnablementService.js";

test("a remote reads the laptop's extension enablement but never changes it; logged once", () => {
	const { warnings, refusals: r } = refusals();
	const changed: string[] = [];
	const base = { isEnabled: () => true, setEnablement: async () => changed.push("set"), canChangeEnablement: () => true } as unknown as IWorkbenchExtensionEnablementService;
	const enablement = reviewRemoteExtensionEnablementService(base, r);
	assert.equal(enablement.isEnabled({} as never), true);
	assert.equal(enablement.canChangeEnablement({} as never), false);
	assert.throws(() => enablement.setEnablement([], 0), /^Error: Not available for an extension on wb-test-a: managing the window's extensions\.$/);
	assert.deepEqual(changed, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused managing the window's extensions`]);
});
