import assert from "node:assert/strict";
import { test } from "node:test";
import { Disposable } from "../../base/common/lifecycle.js";
import { URI } from "../../base/common/uri.js";
import { LanguageFeaturesService } from "../../editor/common/services/languageFeaturesService.js";
import { ReviewLanguageHostPool } from "./reviewLanguageHosts.js";

class Host extends Disposable {
	readonly authority = "";
	readonly languageFeatures = new LanguageFeaturesService();
	closed = false;
	async addRoot() {
		return Disposable.None;
	}
	async activateByEvent() {}
	override dispose() {
		this.closed = true;
		super.dispose();
	}
}
class Pool extends ReviewLanguageHostPool {
	readonly opened: Host[] = [];
	fail = false;
	protected async open() {
		if (this.fail) throw new Error("unavailable");
		const host = new Host();
		this.opened.push(host);
		return host;
	}
}
const base = URI.file("/snapshot/base");
const head = URI.file("/snapshot/head");
const flush = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
};

test("concurrent readers share a snapshot host, different snapshots do not, and idle hosts close", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const pool = new Pool();
	t.after(() => pool.dispose());
	const [a, b, c] = await Promise.all([pool.acquire(base), pool.acquire(base), pool.acquire(head)]);
	assert.equal(a.object, b.object);
	assert.notEqual(a.object, c.object);
	a.dispose();
	a.dispose();
	t.mock.timers.tick(30_000);
	await flush();
	assert.equal(pool.opened[0].closed, false, "another reader keeps the base host alive");
	b.dispose();
	c.dispose();
	t.mock.timers.tick(29_999);
	await flush();
	assert.ok(pool.opened.every((host) => !host.closed));
	const warm = await pool.acquire(base);
	assert.equal(warm.object, a.object, "reopening the same checkout reuses the warm host");
	t.mock.timers.tick(1);
	await flush();
	assert.equal(pool.opened[1].closed, true, "the unused head is closed independently");
	warm.dispose();
	t.mock.timers.tick(30_000);
	await flush();
	assert.equal(pool.opened[0].closed, true);
	const fresh = await pool.acquire(base);
	assert.notEqual(fresh.object, a.object);
	fresh.dispose();
});

test("failed starts can retry and shutdown closes hosts with active readers", async () => {
	const pool = new Pool();
	pool.fail = true;
	await assert.rejects(pool.acquire(base), /unavailable/);
	pool.fail = false;
	const ref = await pool.acquire(base);
	pool.dispose();
	await flush();
	assert.equal(pool.opened[0].closed, true);
	ref.dispose();
	await assert.rejects(pool.acquire(head), /closed/);
});
