import assert from "node:assert/strict";
import test from "node:test";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";
const LINK = "run [this](command:vscode.openFolder?%5B%22file%3A%2F%2F%2FUsers%22%5D) or read [docs](https://example.com)";
const CLEAN = "run [this] or read [docs](https://example.com)";

function refusals() {
	const warnings: string[] = [];
	return { warnings, refusals: new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService) };
}
import type { IProgress, IProgressService, IProgressStep } from "../../../../platform/progress/common/progress.js";
import { ProgressLocation } from "../../../../platform/progress/common/progress.js";
import { reviewRemoteProgressService } from "./reviewRemoteProgressService.js";

test("a remote's progress title and messages keep their web links and lose the rest", async () => {
	const { refusals: r } = refusals();
	const shown: unknown[] = [];
	const base = {
		withProgress: async (options: { title?: string }, task: (progress: IProgress<IProgressStep>) => Promise<unknown>) => {
			shown.push(options.title);
			return task({ report: (step) => shown.push(step.message) });
		},
	} as unknown as IProgressService;
	const progress = reviewRemoteProgressService(base, r);
	await progress.withProgress({ location: ProgressLocation.Notification, title: LINK }, async (p) => {
		p.report({ message: LINK });
		p.report({ increment: 10 });
	});
	assert.deepEqual(shown, [CLEAN, CLEAN, undefined]);
});
