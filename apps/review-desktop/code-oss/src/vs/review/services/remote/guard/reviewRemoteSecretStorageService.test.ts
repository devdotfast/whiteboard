import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "../../../../base/common/event.js";
import type { ISecretStorageService } from "../../../../platform/secrets/common/secrets.js";
import { reviewRemoteSecretStorageService } from "./reviewRemoteSecretStorageService.js";

const A = "whiteboard+aaaa-1111";
const B = "whiteboard+bbbb-2222";
const key = (extensionId: string, name: string) => JSON.stringify({ extensionId, key: name });

test("a host reads and writes its own secrets only, and hears of its own changes only", async () => {
	const values = new Map<string, string>([[key("github.auth", "token"), "laptop-secret"]]);
	const changed = new Emitter<string>();
	const window = {
		type: "persisted",
		get: async (k: string) => values.get(k),
		set: async (k: string, v: string) => { values.set(k, v); changed.fire(k); },
		delete: async (k: string) => { values.delete(k); },
		keys: async () => [...values.keys()],
		onDidChangeSecret: changed.event,
	} as unknown as ISecretStorageService;
	const a = reviewRemoteSecretStorageService(window, A);
	const b = reviewRemoteSecretStorageService(window, B);
	const heard: string[] = [];
	a.onDidChangeSecret((k) => heard.push(k));

	assert.equal(await a.get(key("github.auth", "token")), undefined);
	await a.set(key("wb-test.probe", "x"), "a-secret");
	await b.set(key("wb-test.probe", "x"), "b-secret");
	assert.equal(await a.get(key("wb-test.probe", "x")), "a-secret");
	assert.deepEqual(await a.keys!(), [key("wb-test.probe", "x")]);
	assert.equal(await window.get(key("wb-test.probe", "x")), undefined);
	assert.deepEqual(heard, [key("wb-test.probe", "x")]);
	await a.delete(key("github.auth", "token"));
	assert.equal(await window.get(key("github.auth", "token")), "laptop-secret");
});
