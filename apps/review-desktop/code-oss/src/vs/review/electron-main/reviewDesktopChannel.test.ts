/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";

import { REVIEW_REMOTE_INSTALL_ANSWER_CALL, REVIEW_REMOTE_INSTALL_PROMPT_EVENT } from "../common/reviewRemoteInstallPrompt.js";
import { REVIEW_SSH_ANSWER_CALL, REVIEW_SSH_PROMPT_EVENT, type ReviewSshPromptEvent } from "../common/reviewSshPrompt.js";
import { ReviewSshPromptRelay } from "./remote/reviewSshPromptRelay.js";
import { ReviewDesktopChannel } from "./reviewDesktopChannel.js";

const review = "0199a3f2-7c1e-7d4a-9b2f-3e5d6c7b8a90";
const other = "0199a3f2-7c1e-7d4a-9b2f-3e5d6c7b8a91";
const managed = (id: string, rest = "navigator/workspaces/abc/repo.code-workspace") => `/repo/.git/dev-fast/reviews/${id}/${rest}`;

function channelWith(workspaces: Record<string, unknown>) {
	const closed: string[] = [];
	const windows = Object.entries(workspaces).map(([name, openedWorkspace]) => ({
		openedWorkspace,
		close: () => closed.push(name),
	}));
	const channel = new ReviewDesktopChannel({} as never, { getWindows: () => windows } as never);
	return { channel, closed };
}

test("closes only the source windows of the given reviews", async () => {
	const { channel, closed } = channelWith({
		main: undefined,
		head: { id: "1", configPath: { path: managed(review) } },
		live: { id: "2", configPath: { path: managed(review, "navigator/workspaces/worktree/repo.code-workspace") } },
		other: { id: "3", configPath: { path: managed(other) } },
		folder: { id: "4", uri: { path: managed(review, "head/abc") } },
		lookalike: { id: "5", configPath: { path: `/repo/.git/dev-fast/reviews/${review}x/repo.code-workspace` } },
		elsewhere: { id: "6", configPath: { path: `/projects/${review}/repo.code-workspace` } },
	});

	await channel.call("", "closeSourceWindows", [review]);

	assert.deepEqual(closed, ["head", "live"]);
});

test("matches a review by the storage segment the host names its directory with", async () => {
	const { channel, closed } = channelWith({ shared: { id: "1", configPath: { path: managed("shared__abc") } } });

	await channel.call("", "closeSourceWindows", ["shared:abc"]);

	assert.deepEqual(closed, ["shared"]);
});

test("relays ssh prompts to the window and takes its answer", async () => {
	const relay = new ReviewSshPromptRelay();
	const channel = new ReviewDesktopChannel({} as never, { getWindows: () => [] } as never, relay);
	const events: ReviewSshPromptEvent[] = [];
	channel.listen<ReviewSshPromptEvent>("", REVIEW_SSH_PROMPT_EVENT)((event) => events.push(event));

	const answer = relay.prompt({ alias: "wb-test-a", text: "dev@127.0.0.1's password: ", kind: "secret" });
	await channel.call("", REVIEW_SSH_ANSWER_CALL, { id: events[0].id, answer: "hunter2" });

	assert.equal(await answer, "hunter2");
	relay.dispose();
});

test("lists the SSH aliases, and retries and installs a remote host through the host", async () => {
	const retried: string[] = [];
	const host = {
		listSshAliases: async () => ["devbox", "gpu"],
		retryRemoteHost: (alias: string) => retried.push(alias),
		installRemoteHost: async (alias: string) => void retried.push(`install ${alias}`),
	};
	const channel = new ReviewDesktopChannel(host as never, { getWindows: () => [] } as never);

	assert.deepEqual(await channel.call("", "listSshAliases"), ["devbox", "gpu"]);
	await channel.call("", "retryRemoteHost", "devbox");
	await channel.call("", "retryRemoteHost", { alias: "not a string" });
	await channel.call("", "installRemoteHost", "gpu");
	await channel.call("", "installRemoteHost", 7);

	assert.deepEqual(retried, ["devbox", "install gpu"]);
});

test("reads and connects a remote host's agents through the host, refusing malformed calls", async () => {
	const calls: unknown[] = [];
	const host = {
		detectRemoteAgents: async (alias: string) => (calls.push(["detect", alias]), alias === "gpu" ? [{ id: "pi", connected: false }] : undefined),
		connectRemoteAgents: async (alias: string, ids: unknown[]) => (calls.push(["connect", alias, ids]), [{ id: "pi", connected: true, output: "" }]),
	};
	const channel = new ReviewDesktopChannel(host as never, { getWindows: () => [] } as never);

	assert.deepEqual(await channel.call("", "detectRemoteAgents", "gpu"), [{ id: "pi", connected: false }]);
	assert.equal(await channel.call("", "detectRemoteAgents", "devbox"), null);
	assert.deepEqual(await channel.call("", "connectRemoteAgents", { alias: "gpu", agents: ["pi"] }), [{ id: "pi", connected: true, output: "" }]);
	for (const bad of [undefined, "gpu", { alias: 7, agents: ["pi"] }, { alias: "gpu", agents: "pi" }, { alias: "gpu", agents: Array(17).fill("pi") }]) {
		await assert.rejects(channel.call("", "connectRemoteAgents", bad), /Unknown agents/);
	}
	await assert.rejects(channel.call("", "detectRemoteAgents", 7), /Unknown agents/);

	assert.deepEqual(calls, [["detect", "gpu"], ["detect", "devbox"], ["connect", "gpu", ["pi"]]]);
});

test("relays install prompts apart from ssh prompts", async () => {
	const ssh = new ReviewSshPromptRelay();
	const install = new ReviewSshPromptRelay();
	const channel = new ReviewDesktopChannel({} as never, { getWindows: () => [] } as never, ssh, install);
	const events: ReviewSshPromptEvent[] = [];
	const sshEvents: ReviewSshPromptEvent[] = [];
	channel.listen<ReviewSshPromptEvent>("", REVIEW_REMOTE_INSTALL_PROMPT_EVENT)((event) => events.push(event));
	channel.listen<ReviewSshPromptEvent>("", REVIEW_SSH_PROMPT_EVENT)((event) => sshEvents.push(event));

	const answer = install.prompt({ alias: "box", text: "Whiteboard 0.1.6 is not installed on box.", kind: "confirm" });
	await channel.call("", REVIEW_REMOTE_INSTALL_ANSWER_CALL, { id: events[0].id, answer: "install" });

	assert.equal(await answer, "install");
	assert.deepEqual(sshEvents, []);
	ssh.dispose();
	install.dispose();
});

test("hands a window a remote machine's VS Code server by its server id, and nothing for anything else", async () => {
	const asked: string[] = [];
	const endpoint = { host: "127.0.0.1", port: 50123, connectionToken: "vscode-token" };
	const host = { getRemoteLanguageEndpoint: async (serverId: string) => (asked.push(serverId), serverId === "s1" ? endpoint : undefined) };
	const channel = new ReviewDesktopChannel(host as never, { getWindows: () => [] } as never);

	assert.deepEqual(await channel.call("window", "getRemoteLanguageEndpoint", "s1"), endpoint);
	assert.equal(await channel.call("window", "getRemoteLanguageEndpoint", "s2"), undefined);
	assert.equal(await channel.call("window", "getRemoteLanguageEndpoint", { serverId: "s1" }), undefined);
	assert.deepEqual(asked, ["s1", "s2"]);
});

test("answers an uninstall with the host's reason, or null", async () => {
	const host = { uninstallRemoteHost: async (alias: string) => (alias === "devbox" ? null : `Could not remove Whiteboard from ${alias}.`) };
	const channel = new ReviewDesktopChannel(host as never, { getWindows: () => [] } as never);

	assert.equal(await channel.call("", "uninstallRemoteHost", "devbox"), null);
	assert.equal(await channel.call("", "uninstallRemoteHost", "gpu"), "Could not remove Whiteboard from gpu.");
	await assert.rejects(channel.call("", "uninstallRemoteHost", 7), /needs an alias/);
});
