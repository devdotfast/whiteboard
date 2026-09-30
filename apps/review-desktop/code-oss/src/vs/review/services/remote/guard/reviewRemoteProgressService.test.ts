import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { IProgress, IProgressService, IProgressStep } from "../../../../platform/progress/common/progress.js";
import { ProgressLocation } from "../../../../platform/progress/common/progress.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { reviewRemoteProgressService } from "./reviewRemoteProgressService.js";

const A = "whiteboard+aaaa-1111";
const LINK = "run [this](command:vscode.openFolder?%5B%22file%3A%2F%2F%2FUsers%22%5D) or read [docs](https://example.com)";
const CLEAN = "run this or read [docs](https://example.com)";

function setup() {
	const warnings: string[] = [];
	const shown: unknown[] = [];
	const base = {
		withProgress: async (options: object, task: (progress: IProgress<IProgressStep>) => Promise<unknown>) => {
			shown.push(options);
			return task({ report: (step) => shown.push(step) });
		},
	} as unknown as IProgressService;
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	return { progress: reviewRemoteProgressService(base, refusals), shown, warnings };
}

test("a remote's progress title and messages keep their web links and lose the rest", async () => {
	const { progress, shown } = setup();
	await progress.withProgress({ location: ProgressLocation.Notification, title: LINK, buttons: [LINK] }, async (p) => {
		p.report({ message: LINK });
		p.report({ increment: 10 });
	});
	assert.deepEqual(shown, [
		{ location: ProgressLocation.Notification, title: CLEAN, buttons: [CLEAN] },
		{ message: CLEAN, increment: undefined, total: undefined },
		{ message: undefined, increment: 10, total: undefined },
	]);
});

test("a window progress command is dropped, remote actions without a run function too, and unknown fields do not pass", async () => {
	const { progress, shown, warnings } = setup();
	const own = { id: "manage", label: "Manage", run: () => { } };
	await progress.withProgress({
		location: ProgressLocation.Window, title: "busy", command: "vscode.openFolder",
		secondaryActions: [own, { id: "x", label: "x" }], extra: "command:x",
	} as never, async () => { });
	assert.deepEqual(shown, [{ location: ProgressLocation.Window, title: "busy", secondaryActions: [own] }]);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused commands in progress a remote shows`]);
});
