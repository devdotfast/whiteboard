import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "../../../base/common/event.js";
import { URI } from "../../../base/common/uri.js";
import {
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	type IFileChange,
	type IFileSystemProviderWithFileReadWriteCapability,
	toFileSystemProviderErrorCode,
} from "../../../platform/files/common/files.js";
import { ReviewRemoteFileSystemRouter } from "./reviewRemoteFileSystemRouter.js";

const A = "whiteboard+aaaa-1111";
const B = "whiteboard+bbbb-2222";

function remote(name: string) {
	const changed = new Emitter<readonly IFileChange[]>();
	const provider = {
		onDidChangeFile: changed.event,
		readFile: async (resource: URI) => new TextEncoder().encode(`${name}:${resource.path}`),
		stat: async () => ({ type: 1, ctime: 0, mtime: 0, size: name.length }),
		readdir: async () => [[name, 1]],
		watch: () => ({ dispose() { } }),
		writeFile: async () => { throw new Error(`${name} was written`); },
	} as unknown as IFileSystemProviderWithFileReadWriteCapability;
	return { provider, changed };
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
async function code(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		return toFileSystemProviderErrorCode(error as Error);
	}
	return "resolved";
}

test("each call goes to the host the authority names, whatever its case", async () => {
	const router = new ReviewRemoteFileSystemRouter();
	router.add(A, remote("a").provider);
	router.add(B, remote("b").provider);
	assert.equal(text(await router.readFile(URI.parse(`vscode-remote://${A}/p/a.ts`))), "a:/p/a.ts");
	assert.equal(text(await router.readFile(URI.parse(`vscode-remote://${B}/p/a.ts`))), "b:/p/a.ts");
	assert.equal(text(await router.readFile(URI.parse(`vscode-remote://${A.toUpperCase()}/p/a.ts`))), "a:/p/a.ts");
	assert.deepEqual(await router.readdir(URI.parse(`vscode-remote://${B}/p`)), [["b", 1]]);
	router.dispose();
});

test("an authority that names no connected host is a missing file", async () => {
	const router = new ReviewRemoteFileSystemRouter();
	const added = router.add(A, remote("a").provider);
	assert.equal(await code(router.stat(URI.parse(`vscode-remote://${B}/p/a.ts`))), FileSystemProviderErrorCode.FileNotFound);
	added.dispose();
	assert.equal(await code(router.readFile(URI.parse(`vscode-remote://${A}/p/a.ts`))), FileSystemProviderErrorCode.FileNotFound);
	router.dispose();
});

test("it is read-only and refuses every change without reaching a host", async () => {
	const router = new ReviewRemoteFileSystemRouter();
	router.add(A, remote("a").provider);
	const file = URI.parse(`vscode-remote://${A}/p/a.ts`);
	assert.ok(router.capabilities & FileSystemProviderCapabilities.Readonly);
	for (const change of [
		router.writeFile(),
		router.mkdir(),
		router.delete(),
		router.rename(),
	]) assert.equal(await code(change), FileSystemProviderErrorCode.NoPermissions);
	assert.equal(text(await router.readFile(file)), "a:/p/a.ts");
	router.dispose();
});

test("changes from a host are passed on until that host is removed, and a newer host keeps its route", async () => {
	const router = new ReviewRemoteFileSystemRouter();
	const first = remote("first");
	const second = remote("second");
	const seen: string[] = [];
	router.onDidChangeFile((changes) => seen.push(...changes.map((change) => change.resource.path)));
	const removeFirst = router.add(A, first.provider);
	first.changed.fire([{ type: 0, resource: URI.parse(`vscode-remote://${A}/one`) }]);
	router.add(A, second.provider);
	removeFirst.dispose();
	first.changed.fire([{ type: 0, resource: URI.parse(`vscode-remote://${A}/two`) }]);
	second.changed.fire([{ type: 0, resource: URI.parse(`vscode-remote://${A}/three`) }]);
	assert.deepEqual(seen, ["/one", "/three"]);
	assert.equal(text(await router.readFile(URI.parse(`vscode-remote://${A}/p`))), "second:/p");
	router.dispose();
});
