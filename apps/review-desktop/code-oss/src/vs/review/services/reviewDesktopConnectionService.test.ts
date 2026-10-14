/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";

import { ReviewDesktopConnectionService } from "./reviewDesktopConnectionService.js";

function serviceWith(): ReviewDesktopConnectionService {
	const service = new ReviewDesktopConnectionService({} as never);
	Object.assign(service, {
		connection: {
			version: 1,
			url: "http://127.0.0.1:5000",
			token: "token",
			instanceId: "instance",
		},
		initializePromise: Promise.resolve(),
	});
	return service;
}

function mockFetch(t: { after(callback: () => void): void }, handler: typeof fetch): void {
	const original = globalThis.fetch;
	globalThis.fetch = handler;
	t.after(() => {
		globalThis.fetch = original;
	});
}

test("install status shares concurrent scans and refreshes on subsequent checks", async (t) => {
	const service = serviceWith();
	t.after(() => service.dispose());
	let requests = 0;
	mockFetch(t, async () => {
		requests += 1;
		if (requests === 3) return Response.json({ error: "scan failed" }, { status: 500 });
		return Response.json({
			fingerprint: "test", stamp: null, stale: requests > 1, updateNeeded: false,
			shim: { path: "/tmp/review", installed: false, profileConfigured: false, onPath: false },
			trace: { enabled: false, configured: false, autoActivateRepositories: false, envPath: "/tmp/env", settingsPath: "/tmp/settings" },
			cli: null,
			connect: { command: "review", args: ["mcp"], prompts: { claude: "c", codex: "c", cursor: "c", opencode: "c", pi: "c", omp: "c", copilot: "c" }, plugins: { claude: { label: "c" }, codex: { label: "c" }, cursor: { label: "c" }, opencode: { label: "c" }, pi: { label: "c" }, omp: { label: "c" }, copilot: { label: "c" } } },
			legacySkills: [],
		});
	});

	const [first, second] = await Promise.all([
		service.getCliInstallStatus(),
		service.getCliInstallStatus(),
	]);
	assert.equal(first.stale, false);
	assert.equal(second.stale, false);
	assert.equal(requests, 1);
	assert.equal((await service.getCliInstallStatus()).stale, true);
	assert.equal(requests, 2);
	await assert.rejects(service.getCliInstallStatus(), /scan failed/);
	assert.equal((await service.getCliInstallStatus()).stale, true);
	assert.equal(requests, 4);
});

test("reads the remote hosts' states from the Desktop server", async (t) => {
	const service = serviceWith();
	t.after(() => service.dispose());
	const requests: string[] = [];
	const answer = [{ alias: "devbox", serverId: "s1", state: "online" }, { alias: "box2", state: "not-installed", detail: "Install it.", installCommand: "npm install -g @dev.fast/whiteboard@0.1.6", declined: true }];
	mockFetch(t, async (input, init) => {
		requests.push(`${String(input)} ${new Headers(init?.headers).get("x-review-token")}`);
		return Response.json(answer);
	});

	assert.deepEqual(await service.readRemoteHosts(), answer);
	assert.deepEqual(requests, ["http://127.0.0.1:5000/remote-hosts token"]);
});
