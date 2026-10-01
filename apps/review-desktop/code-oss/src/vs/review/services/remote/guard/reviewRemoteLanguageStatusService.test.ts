import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { ILanguageStatus, ILanguageStatusService } from "../../../../workbench/services/languageStatus/common/languageStatusService.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { reviewRemoteLanguageStatusService } from "./reviewRemoteLanguageStatusService.js";

const A = "whiteboard+aaaa-1111";

test("a remote's language status items, with their commands, never reach the window's registry", () => {
	const warnings: string[] = [];
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	const added: ILanguageStatus[] = [];
	const status = reviewRemoteLanguageStatusService({ addStatus: (item: ILanguageStatus) => { added.push(item); return { dispose() { } }; } } as unknown as ILanguageStatusService, refusals);
	const item = { id: "probe", label: "wb probe", detail: "[open](command:vscode.openFolder)", command: { id: "vscode.openFolder", title: "Open" } } as unknown as ILanguageStatus;
	for (let i = 0; i < 2; i++) status.addStatus(item).dispose();
	assert.deepEqual(added, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused showing language status items`]);
});
