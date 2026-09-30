import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionStorageService } from "../../../../platform/extensionManagement/common/extensionStorage.js";
import { NullLogService } from "../../../../platform/log/common/log.js";
import type { IProductService } from "../../../../platform/product/common/productService.js";
import { InMemoryStorageService, type IStorageService, StorageScope, StorageTarget } from "../../../../platform/storage/common/storage.js";
import { reviewRemoteStorageService } from "./reviewRemoteStorageService.js";

const A = "whiteboard+aaaa-1111";
const B = "whiteboard+bbbb-2222";

test("a host's storage and extension state are its own: not the laptop's, not another host's", (t) => {
	const window = new InMemoryStorageService();
	t.after(() => window.dispose());
	const extensionState = (storage: IStorageService = window) => new ExtensionStorageService(storage, {} as IProductService, new NullLogService());
	extensionState().setExtensionState("laptop.ext", { token: "laptop" }, true);
	const a = extensionState(reviewRemoteStorageService(window, A));
	const b = extensionState(reviewRemoteStorageService(window, B));

	assert.equal(a.getExtensionState("laptop.ext", true), undefined);
	a.setExtensionState("wb-test.probe", { seen: "a" }, true);
	assert.deepEqual(a.getExtensionState("wb-test.probe", true), { seen: "a" });
	assert.equal(b.getExtensionState("wb-test.probe", true), undefined);
	assert.equal(extensionState().getExtensionState("wb-test.probe", true), undefined);
	assert.deepEqual(extensionState().getExtensionState("laptop.ext", true), { token: "laptop" });
});

test("keys and change events show only the host's own keys, without the prefix", (t) => {
	const window = new InMemoryStorageService();
	t.after(() => window.dispose());
	const a = reviewRemoteStorageService(window, A);
	const seen: string[] = [];
	const listener = a.onDidChangeValue(StorageScope.PROFILE, undefined, undefined as never)((e) => seen.push(e.key));
	window.store("laptop.key", "1", StorageScope.PROFILE, StorageTarget.MACHINE);
	a.store("probe.key", "2", StorageScope.PROFILE, StorageTarget.MACHINE);
	listener.dispose();
	assert.deepEqual(seen, ["probe.key"]);
	assert.deepEqual(a.keys(StorageScope.PROFILE, StorageTarget.MACHINE), ["probe.key"]);
	assert.equal(window.get(`${A}/probe.key`, StorageScope.PROFILE), "2");
});
