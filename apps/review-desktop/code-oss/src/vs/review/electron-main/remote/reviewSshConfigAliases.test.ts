/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listSshAliases } from "./reviewSshConfigAliases.js";

async function fixture(t: test.TestContext, files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "wb-ssh-aliases-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	for (const [name, text] of Object.entries(files)) {
		await mkdir(join(dir, name, ".."), { recursive: true });
		await writeFile(join(dir, name), text);
	}
	return dir;
}

test("lists Host aliases in file order, follows Include globs, and skips patterns", async (t) => {
	const dir = await fixture(t, {
		config: [
			"# comment",
			"Host first second",
			"  HostName 10.0.0.1",
			"include conf.d/*.conf",
			"Host *",
			"  ServerAliveInterval 30",
			"Host *.example.com web? !blocked kept",
			"HOST=equals",
			"Match host first exec true",
			"  User dev",
			'Host "quoted"',
			"Host first",
			"Include missing/*.conf",
		].join("\n"),
		"conf.d/b.conf": "Host from-b\n",
		"conf.d/a.conf": "Host from-a first\n",
		"conf.d/skip.txt": "Host not-included\n",
	});

	assert.deepEqual(await listSshAliases(join(dir, "config")), [
		"first",
		"second",
		"from-a",
		"from-b",
		"kept",
		"equals",
		"quoted",
	]);
});

test("follows absolute Include paths and stops a cyclic Include", async (t) => {
	const other = await fixture(t, { extra: "Host absolute\n" });
	const dir = await fixture(t, {
		config: `Host top\nInclude loop ${join(other, "extra")}\n`,
		loop: "Host looped\nInclude config\nInclude loop\n",
	});

	assert.deepEqual(await listSshAliases(join(dir, "config")), ["top", "looped", "absolute"]);
});

test("leaves out aliases Whiteboard would refuse", async (t) => {
	const dir = await fixture(t, { config: 'Host ok db(prod) -flag a;b "two words"\n' });

	assert.deepEqual(await listSshAliases(join(dir, "config")), ["ok"]);
});

test("a missing or unreadable file gives an empty list", async (t) => {
	const dir = await fixture(t, { "config/inner": "" });
	assert.deepEqual(await listSshAliases(join(dir, "nothing")), []);
	assert.deepEqual(await listSshAliases(join(dir, "config")), []);
});
