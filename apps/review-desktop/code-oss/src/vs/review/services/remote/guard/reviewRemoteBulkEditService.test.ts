import assert from "node:assert/strict";
import test from "node:test";
import type { IBulkEditService } from "../../../../editor/browser/services/bulkEditService.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { ReviewRemoteBulkEditService } from "./reviewRemoteBulkEditService.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";

test("workspace edits are refused, even on the host's own files, logged once", async () => {
	const warnings: string[] = [];
	const edits: IBulkEditService = new ReviewRemoteBulkEditService(new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService));
	await assert.rejects(edits.apply([]), /^Error: Not available for an extension on wb-test-a: editing documents or files\.$/);
	await assert.rejects(edits.apply([]), /editing documents or files/);
	assert.equal(edits.hasPreviewHandler(), false);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused editing documents or files`]);
});
