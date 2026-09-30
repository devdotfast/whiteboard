import assert from "node:assert/strict";
import test from "node:test";
import type { IClipboardService } from "../../../../platform/clipboard/common/clipboardService.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteClipboardService } from "./reviewRemoteClipboardService.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

test("the clipboard is neither read nor written, and the refusal is logged once", async () => {
	const warnings: string[] = [];
	const clipboard: IClipboardService = new ReviewRemoteClipboardService(new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService));
	await assert.rejects(clipboard.readText(), /^Error: Not available for an extension on wb-test-a: using the clipboard\.$/);
	await assert.rejects(clipboard.writeText("x"), /using the clipboard/);
	await assert.rejects(clipboard.readResources(), /using the clipboard/);
	await assert.rejects(clipboard.readImage(), /using the clipboard/);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused using the clipboard`]);
});
