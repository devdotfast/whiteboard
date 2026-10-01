import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import { FileChangesEvent, FileChangeType, type IFileService } from "../../../../platform/files/common/files.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import { reviewRemoteFileService } from "./reviewRemoteFileService.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";

const A = "whiteboard+aaaa-1111";
const own = URI.parse(`vscode-remote://${A}/home/dev/proj/a.ts`);
const refused = /^Error: Not available for an extension on wb-test-a: /;

function setup() {
	const warnings: string[] = [];
	const calls: string[] = [];
	const changes = new Emitter<FileChangesEvent>();
	const base = {
		readFile: async (resource: URI) => { calls.push(`readFile ${resource}`); return { value: "x" }; },
		stat: async (resource: URI) => { calls.push(`stat ${resource}`); return {}; },
		writeFile: async () => calls.push("writeFile"),
		del: async () => calls.push("del"),
		registerProvider: () => calls.push("registerProvider"),
		onDidFilesChange: changes.event,
	} as unknown as IFileService;
	const ownCalls: string[] = [];
	const own = {
		writeFile: async (resource: URI) => ownCalls.push(`writeFile ${resource}`),
		copy: async (source: URI, target: URI) => ownCalls.push(`copy ${source} ${target}`),
		move: async (source: URI, target: URI) => ownCalls.push(`move ${source} ${target}`),
		createFolder: async (resource: URI) => ownCalls.push(`createFolder ${resource}`),
		del: async (resource: URI) => ownCalls.push(`del ${resource}`),
		canDelete: async () => true,
	} as unknown as IFileService;
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	return { files: reviewRemoteFileService(base, refusals, own), calls, ownCalls, warnings, changes };
}

test("a host reads its own files through the window's file service", async () => {
	const { files, calls } = setup();
	assert.deepEqual(await files.readFile(own), { value: "x" });
	await files.stat(own);
	assert.deepEqual(calls, [`readFile ${own}`, `stat ${own}`]);
});

test("the laptop's files, its profile and another host's files are refused, and each kind is logged once", async () => {
	const { files, calls, warnings } = setup();
	for (const uri of [
		URI.file("/etc/hosts"),
		URI.parse("vscode-userdata:/Users/me/Library/settings.json"),
		URI.parse("vscode-remote://whiteboard+bbbb-2222/home/dev/proj/a.ts"),
		URI.parse("vscode-remote://other-authority/etc/hosts"),
	]) {
		await assert.rejects(files.readFile(uri), refused, uri.toString());
		await assert.rejects(files.stat(uri), refused, uri.toString());
	}
	assert.equal(await files.canHandleResource(URI.file("/etc/hosts")), false);
	assert.deepEqual(calls, []);
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused reading files outside this remote`]);
});

test("a host changes its own files through its own connection, never the window's", async () => {
	const { files, calls, ownCalls } = setup();
	const other = URI.parse(`vscode-remote://${A}/home/dev/proj/b.ts`);
	await files.writeFile(own, undefined as never);
	await files.copy(own, other);
	await files.move(other, own);
	await files.createFolder(other);
	await files.del(other);
	assert.equal(await files.canDelete(own), true);
	assert.deepEqual(ownCalls, [
		`writeFile ${own}`,
		`copy ${own} ${other}`,
		`move ${other} ${own}`,
		`createFolder ${other}`,
		`del ${other}`,
	]);
	assert.deepEqual(calls, []);
});

test("it changes nothing on the laptop or another host, and registers no file system", async () => {
	const { files, calls, ownCalls, warnings } = setup();
	const laptop = URI.file("/tmp/x");
	const otherHost = URI.parse("vscode-remote://whiteboard+bbbb-2222/home/dev/proj/a.ts");
	for (const uri of [laptop, otherHost, URI.parse("vscode-userdata:/Users/me/Library/settings.json")]) {
		assert.throws(() => files.writeFile(uri, undefined as never), refused, uri.toString());
		assert.throws(() => files.del(uri), refused, uri.toString());
		assert.throws(() => files.createFolder(uri), refused, uri.toString());
		assert.ok(await files.canDelete(uri) instanceof Error);
	}
	// A copy or move is refused when either end is not this host's.
	assert.throws(() => files.copy(own, laptop), refused);
	assert.throws(() => files.move(otherHost, own), refused);
	assert.throws(() => files.registerProvider("file", {} as never), refused);
	assert.equal(files.getProvider("vscode-remote"), undefined);
	assert.deepEqual([calls, ownCalls], [[], []]);
	assert.deepEqual(warnings, [
		`[Remote guard] ${A}: refused changing files outside this remote`,
		`[Remote guard] ${A}: refused registering a file system`,
	]);
});

test("change events carry only this host's files", () => {
	const { files, changes } = setup();
	const seen: string[][] = [];
	const listener = files.onDidFilesChange((e) => seen.push([...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted].map(String)));
	changes.fire(new FileChangesEvent([{ resource: URI.file("/Users/me/secret"), type: FileChangeType.UPDATED }], false));
	changes.fire(new FileChangesEvent([
		{ resource: URI.file("/Users/me/new"), type: FileChangeType.ADDED },
		{ resource: own, type: FileChangeType.DELETED },
	], false));
	listener.dispose();
	assert.deepEqual(seen, [[own.toString()]]);
});

test("watching outside this remote is refused, logged once", () => {
	const { files, warnings } = setup();
	for (const uri of [URI.file("/Users/me/.ssh"), URI.parse("vscode-remote://whiteboard+bbbb-2222/home/dev")]) {
		assert.throws(() => files.watch(uri), refused);
		assert.throws(() => files.createWatcher(uri, { recursive: false, excludes: [] }), refused);
	}
	assert.deepEqual(warnings, [`[Remote guard] ${A}: refused watching files outside this remote`]);
});
