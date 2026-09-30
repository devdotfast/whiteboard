/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reviewEnabledExtensionGroups } from "./reviewEnabledExtensionGroups.js";

const entry = (id: string, version: string) => ({ identifier: { id }, version, relativeLocation: `${id.toLowerCase()}-${version}` });

test("a group counts once its primary extension is installed and not being removed", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "wb-groups-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(
		join(dir, "extensions.json"),
		JSON.stringify([
			entry("golang.Go", "0.56.0"),
			entry("rust-lang.rust-analyzer", "0.4.2990"),
			// A support extension alone does not enable its group.
			entry("llvm-vs-code-extensions.lldb-dap", "0.7.20260804"),
			entry("ms-python.python", "2026.4.0"),
		]),
	);
	await writeFile(join(dir, ".obsolete"), JSON.stringify({ "rust-lang.rust-analyzer-0.4.2990": true }));

	assert.deepEqual(await reviewEnabledExtensionGroups(dir), ["go"]);
});

test("no list, or an unreadable one, enables nothing", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "wb-groups-"));
	t.after(() => rm(dir, { recursive: true, force: true }));

	assert.deepEqual(await reviewEnabledExtensionGroups(dir), []);
	await writeFile(join(dir, "extensions.json"), "{");
	assert.deepEqual(await reviewEnabledExtensionGroups(dir), []);
});
