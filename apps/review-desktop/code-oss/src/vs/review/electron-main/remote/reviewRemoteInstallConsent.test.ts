/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openRemoteInstallConsent } from "./reviewRemoteInstallConsent.js";

async function file(t: test.TestContext) {
	const dir = await mkdtemp(join(tmpdir(), "wb-consent-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return join(dir, "remote-install-consent.json");
}

test("a consent given before the first attach moves to the server id, and follows a renamed alias", async (t) => {
	const path = await file(t);
	const consent = openRemoteInstallConsent(path);

	await consent.set("box", "allow");
	assert.equal(await consent.get("box"), "allow");
	await consent.attached("box", "server-1");

	assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { servers: { "server-1": { consent: "allow", alias: "box" } }, aliases: {} });
	assert.equal((await stat(path)).mode & 0o777, 0o600);
	// Another process reads the same file, as after a relaunch.
	const again = openRemoteInstallConsent(path);
	assert.equal(await again.get("box"), "allow");
	await again.attached("renamed", "server-1");
	assert.equal(await again.get("renamed"), "allow");
	assert.equal(await again.get("box"), undefined);
});

test("a decline is kept per alias until the user agrees, and an attach without consent stores nothing", async (t) => {
	const path = await file(t);
	const consent = openRemoteInstallConsent(path);

	await consent.attached("other", "server-2");
	assert.equal(await consent.get("other"), undefined);
	await consent.set("box", "deny");
	assert.equal(await openRemoteInstallConsent(path).get("box"), "deny");
	await consent.set("box", "allow");
	assert.equal(await consent.get("box"), "allow");
});

test("an agreement for a host known by its server id is stored under that id", async (t) => {
	const path = await file(t);
	const consent = openRemoteInstallConsent(path);

	await consent.set("box", "deny");
	await consent.attached("box", "server-1");
	await consent.set("box", "allow");

	assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { servers: { "server-1": { consent: "allow", alias: "box" } }, aliases: {} });
});

test("an unreadable file is no consent, and is replaced on the next answer", async (t) => {
	const path = await file(t);
	await writeFile(path, "{not json");
	const consent = openRemoteInstallConsent(path);

	assert.equal(await consent.get("box"), undefined);
	await consent.set("box", "allow");
	assert.equal(await consent.get("box"), "allow");
});

test("an unchanged answer is not written again, and __proto__ is an ordinary key", async (t) => {
	const path = await file(t);
	const consent = openRemoteInstallConsent(path);

	await consent.set("box", "allow");
	await consent.attached("box", "server-1");
	const written = (await stat(path)).mtimeMs;
	await new Promise((resolve) => setTimeout(resolve, 20));
	await consent.attached("box", "server-1");
	await consent.set("box", "allow");
	assert.equal((await stat(path)).mtimeMs, written);

	await consent.set("__proto__", "deny");
	assert.equal(await openRemoteInstallConsent(path).get("__proto__"), "deny");
	assert.equal(await consent.get("box"), "allow");
});
