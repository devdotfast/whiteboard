import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "../../../base/common/event.js";
import { URI } from "../../../base/common/uri.js";
import {
	FilePermission,
	FileSystemProviderErrorCode,
	type IFileChange,
	type IFileSystemProviderWithFileReadWriteCapability,
	toFileSystemProviderErrorCode,
} from "../../../platform/files/common/files.js";
import { ReviewRemoteFileSystemRouter } from "./reviewRemoteFileSystemRouter.js";

const A = "whiteboard+aaaa-1111";
const B = "whiteboard+bbbb-2222";
const storage = (authority: string) => URI.parse(`vscode-remote://${authority}/data/User/workspaceStorage`);

function remote(name: string, written: string[] = []) {
	const changed = new Emitter<readonly IFileChange[]>();
	const provider = {
		onDidChangeFile: changed.event,
		readFile: async (resource: URI) => new TextEncoder().encode(`${name}:${resource.path}`),
		stat: async () => ({ type: 1, ctime: 0, mtime: 0, size: name.length }),
		readdir: async () => [[name, 1]],
		watch: () => ({ dispose() { } }),
		writeFile: async (resource: URI) => { written.push(`${name}:${resource.path}`); },
		mkdir: async (resource: URI) => { written.push(`${name}:${resource.path}`); },
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
	router.add(A, remote("a").provider, [storage(A)]);
	router.add(B, remote("b").provider, [storage(B)]);
	assert.equal(text(await router.readFile(URI.parse(`vscode-remote://${A}/p/a.ts`))), "a:/p/a.ts");
	assert.equal(text(await router.readFile(URI.parse(`vscode-remote://${B}/p/a.ts`))), "b:/p/a.ts");
	assert.equal(text(await router.readFile(URI.parse(`vscode-remote://${A.toUpperCase()}/p/a.ts`))), "a:/p/a.ts");
	assert.deepEqual(await router.readdir(URI.parse(`vscode-remote://${B}/p`)), [["b", 1]]);
	router.dispose();
});

test("an authority that names no connected host is a missing file", async () => {
	const router = new ReviewRemoteFileSystemRouter();
	const added = router.add(A, remote("a").provider, [storage(A)]);
	assert.equal(await code(router.stat(URI.parse(`vscode-remote://${B}/p/a.ts`))), FileSystemProviderErrorCode.FileNotFound);
	added.dispose();
	assert.equal(await code(router.readFile(URI.parse(`vscode-remote://${A}/p/a.ts`))), FileSystemProviderErrorCode.FileNotFound);
	router.dispose();
});

test("review files are read-only, but the host's storage is written on that host", async () => {
	const router = new ReviewRemoteFileSystemRouter();
	const written: string[] = [];
	router.add(A, remote("a", written).provider, [storage(A)]);
	router.add(B, remote("b", written).provider, [storage(B)]);
	const source = URI.parse(`vscode-remote://${A}/repo/a.py`);
	const stored = URI.parse(`vscode-remote://${A}/data/User/workspaceStorage/ws/ms-python.python/pythonrc.py`);
	const escape = URI.parse(`vscode-remote://${A}/data/User/workspaceStorage/../../../repo/a.py`);
	const options = { create: true, overwrite: true, unlock: false, atomic: false } as const;
	assert.equal(await code(router.writeFile(source, new Uint8Array(), options)), FileSystemProviderErrorCode.NoPermissions);
	assert.equal(await code(router.writeFile(escape, new Uint8Array(), options)), FileSystemProviderErrorCode.NoPermissions);
	assert.ok(((await router.stat(source)).permissions ?? 0) & FilePermission.Readonly);
	assert.ok(!(((await router.stat(stored)).permissions ?? 0) & FilePermission.Readonly));
	await router.mkdir(URI.parse(`vscode-remote://${A}/data/User/workspaceStorage/ws`));
	await router.writeFile(stored, new Uint8Array(), options);
	assert.deepEqual(written, ["a:/data/User/workspaceStorage/ws", "a:/data/User/workspaceStorage/ws/ms-python.python/pythonrc.py"]);
	router.dispose();
});

test("changes from a host are passed on until that host is removed, and a newer host keeps its route", async () => {
	const router = new ReviewRemoteFileSystemRouter();
	const first = remote("first");
	const second = remote("second");
	const seen: string[] = [];
	router.onDidChangeFile((changes) => seen.push(...changes.map((change) => change.resource.path)));
	const removeFirst = router.add(A, first.provider, []);
	first.changed.fire([{ type: 0, resource: URI.parse(`vscode-remote://${A}/one`) }]);
	router.add(A, second.provider, []);
	removeFirst.dispose();
	first.changed.fire([{ type: 0, resource: URI.parse(`vscode-remote://${A}/two`) }]);
	second.changed.fire([{ type: 0, resource: URI.parse(`vscode-remote://${A}/three`) }]);
	assert.deepEqual(seen, ["/one", "/three"]);
	assert.equal(text(await router.readFile(URI.parse(`vscode-remote://${A}/p`))), "second:/p");
	router.dispose();
});


test("closing one snapshot's connection leaves another snapshot on the same machine usable", async () => {
	const router = new ReviewRemoteFileSystemRouter();
	const first = router.add(A, remote("first").provider, [storage(A)]);
	const second = router.add(A, remote("second").provider, [storage(A)]);
	second.dispose();
	assert.equal(text(await router.readFile(URI.parse(`vscode-remote://${A}/repo/file.kt`))), "first:/repo/file.kt");
	assert.equal(((await router.stat(URI.joinPath(storage(A), "base/state.json"))).permissions ?? 0) & FilePermission.Readonly, 0);
	first.dispose();
	assert.equal(await code(router.stat(URI.parse(`vscode-remote://${A}/repo/file.kt`))), FileSystemProviderErrorCode.FileNotFound);
	router.dispose();
});
