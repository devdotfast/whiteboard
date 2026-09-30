import assert from "node:assert/strict";
import test from "node:test";
import { URI } from "../../../../base/common/uri.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { IWorkspaceEditingService } from "../../../../workbench/services/workspaces/common/workspaceEditing.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { ReviewRemoteWorkspaceEditingService } from "./reviewRemoteWorkspaceEditingService.js";

const A = "whiteboard+aaaa-1111";

test("the window's workspace folders are not changed, logged once", async () => {
	const warnings: string[] = [];
	const editing: IWorkspaceEditingService = new ReviewRemoteWorkspaceEditingService(new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService));
	await assert.rejects(editing.updateFolders(0, 0, [{ uri: URI.file("/Users/me") }]), /^Error: Not available for an extension on wb-test-a: changing the window's workspace\.$/);
	await assert.rejects(editing.addFolders([{ uri: URI.file("/") }]), /changing the window's workspace/);
	await assert.rejects(editing.enterWorkspace(URI.file("/tmp/x.code-workspace")), /changing the window's workspace/);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused changing the window's workspace`]);
});
