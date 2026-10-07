import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "../../../base/common/event.js";
import { URI } from "../../../base/common/uri.js";
import { FileChangesEvent, FileChangeType, FileOperation, FileOperationEvent, type IFileService } from "../../../platform/files/common/files.js";
import { reviewRemoteFileEvents } from "./reviewRemoteFileEvents.js";

const A = "whiteboard+aaaa-1111";
const B = "whiteboard+bbbb-2222";
const onA = URI.parse(`vscode-remote://${A}/home/dev/repo/f.ts`);
const onB = URI.parse(`vscode-remote://${B}/home/dev/repo/f.ts`);
const laptop = URI.file("/home/dev/repo/f.ts");

test("a host hears only its own file changes and operations, though another host and the laptop have the same path", () => {
	const changes = new Emitter<FileChangesEvent>();
	const operations = new Emitter<FileOperationEvent>();
	const window = { onDidFilesChange: changes.event, onDidRunOperation: operations.event, readFile: async () => "the window's" } as unknown as IFileService;
	const listen = (authority: string) => {
		const files = reviewRemoteFileEvents(window, authority);
		const seen: string[] = [];
		files.onDidFilesChange((e) => seen.push(...e.rawUpdated.map((uri) => `changed ${uri}`), ...e.rawDeleted.map((uri) => `deleted ${uri}`)));
		files.onDidRunOperation((e) => seen.push(`wrote ${e.resource}`));
		return { files, seen };
	};
	const [a, b] = [listen(A), listen(B)];

	changes.fire(new FileChangesEvent([{ resource: onA, type: FileChangeType.UPDATED }, { resource: laptop, type: FileChangeType.UPDATED }], false));
	changes.fire(new FileChangesEvent([{ resource: laptop, type: FileChangeType.DELETED }], false));
	operations.fire(new FileOperationEvent(onA, FileOperation.WRITE));
	operations.fire(new FileOperationEvent(laptop, FileOperation.WRITE));

	assert.deepEqual(a.seen, [`changed ${onA}`, `wrote ${onA}`]);
	assert.deepEqual(b.seen, []);
	return b.files.readFile(onB).then((value) => assert.equal(value, "the window's", "reads still go to the window's service"));
});
