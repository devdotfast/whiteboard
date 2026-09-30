import assert from "node:assert/strict";
import test from "node:test";
import { CancellationToken } from "../../../../base/common/cancellation.js";
import { Emitter } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import { FileOperation } from "../../../../platform/files/common/files.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { IWorkingCopyFileService, WorkingCopyFileEvent } from "../../../../workbench/services/workingCopy/common/workingCopyFileService.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { reviewRemoteWorkingCopyFileService } from "./reviewRemoteWorkingCopyFileService.js";

const A = "whiteboard+aaaa-1111";
const own = URI.parse(`vscode-remote://${A}/home/dev/proj/a.ts`);

test("the laptop's file operations never reach a host, and a host joins none of them", () => {
	const warnings: string[] = [];
	const registered: string[] = [];
	const ran = new Emitter<WorkingCopyFileEvent>();
	const base = {
		addFileOperationParticipant: () => registered.push("participant"),
		registerWorkingCopyProvider: () => registered.push("provider"),
		onDidRunWorkingCopyFileOperation: ran.event,
		move: async () => registered.push("move"),
	} as unknown as IWorkingCopyFileService;
	const files = reviewRemoteWorkingCopyFileService(base, new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService));
	files.addFileOperationParticipant({ participate: async () => { } }).dispose();
	files.registerWorkingCopyProvider(() => []).dispose();
	const seen: string[][] = [];
	files.onDidRunWorkingCopyFileOperation((e) => seen.push(e.files.map(({ target }) => target.toString())));
	ran.fire({ correlationId: 1, operation: FileOperation.MOVE, files: [{ source: URI.file("/Users/me/a.md"), target: URI.file("/Users/me/b.md") }] } as unknown as WorkingCopyFileEvent);
	ran.fire({ correlationId: 2, operation: FileOperation.DELETE, files: [{ target: own }] } as unknown as WorkingCopyFileEvent);
	assert.deepEqual(seen, [[own.toString()]]);
	assert.throws(() => files.move([], CancellationToken.None), /^Error: Not available for an extension on wb-test-a: changing files\.$/);
	assert.deepEqual(registered, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused changing files`]);
});
