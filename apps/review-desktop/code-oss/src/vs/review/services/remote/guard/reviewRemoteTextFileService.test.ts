import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "../../../../base/common/event.js";
import { URI } from "../../../../base/common/uri.js";
import type { ILogService } from "../../../../platform/log/common/log.js";
import type { ITextFileService } from "../../../../workbench/services/textfile/common/textfiles.js";
import { ReviewRemoteRefusals } from "./reviewRemoteGuard.js";
import { reviewRemoteTextFileService } from "./reviewRemoteTextFileService.js";

const A = "whiteboard+aaaa-1111";
const own = URI.parse(`vscode-remote://${A}/home/dev/proj/a.ts`);
const laptop = URI.file("/Users/me/notes.txt");
const refused = /^Error: Not available for an extension on wb-test-a: /;

function setup() {
	const warnings: string[] = [];
	const calls: string[] = [];
	const saved = new Emitter<{ model: { resource: URI } }>();
	const record = (name: string) => async (resource?: URI) => { calls.push(`${name} ${resource}`); return {}; };
	const base = {
		save: record("save"),
		read: record("read"),
		resolveEncoding: record("resolveEncoding"),
		files: { resolve: record("files.resolve"), addSaveParticipant: () => calls.push("addSaveParticipant"), onDidSave: saved.event, onDidChangeDirty: saved.event, onDidChangeEncoding: saved.event },
		untitled: { create: () => calls.push("untitled.create"), onDidChangeEncoding: saved.event },
	} as unknown as ITextFileService;
	const refusals = new ReviewRemoteRefusals(A, () => "wb-test-a", { warn: (message: string) => warnings.push(message) } as unknown as ILogService);
	return { files: reviewRemoteTextFileService(base, refusals), calls, warnings, saved };
}

test("a host reads its own files", async () => {
	const { files, calls } = setup();
	await files.read(own);
	await files.files.resolve(own);
	await files.resolveEncoding(own);
	assert.deepEqual(calls, [`read ${own}`, `files.resolve ${own}`, `resolveEncoding ${own}`]);
});

test("saves, untitled documents, laptop reads and save participants are refused; each kind logged once", async () => {
	const { files, calls, warnings, saved } = setup();
	assert.throws(() => files.save(own), refused);
	assert.throws(() => files.save(laptop), refused);
	await assert.rejects(files.read(laptop), refused);
	await assert.rejects(files.files.resolve(laptop), refused);
	await assert.rejects(files.resolveEncoding(laptop), refused);
	assert.throws(() => files.untitled.create({ initialValue: "x" }), refused);
	files.files.addSaveParticipant({ participate: async () => { } }).dispose();
	const heard: string[] = [];
	files.files.onDidSave((e) => heard.push(e.model.resource.toString()));
	saved.fire({ model: { resource: laptop } });
	saved.fire({ model: { resource: own } });
	assert.deepEqual(heard, [own.toString()]);
	assert.deepEqual(calls, []);
	assert.deepEqual(warnings, [
		`[Remote guard] ${A}: refused saving or changing files`,
		`[Remote guard] ${A}: refused reading files outside this remote`,
		`[Remote guard] ${A}: refused creating untitled documents`,
	]);
});
