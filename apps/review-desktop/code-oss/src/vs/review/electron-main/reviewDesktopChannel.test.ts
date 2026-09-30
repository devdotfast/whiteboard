/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";

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

test("lists the SSH aliases and retries a remote host through the host", async () => {
	const retried: string[] = [];
	const host = { listSshAliases: async () => ["devbox", "gpu"], retryRemoteHost: (alias: string) => retried.push(alias) };
	const channel = new ReviewDesktopChannel(host as never, { getWindows: () => [] } as never);

	assert.deepEqual(await channel.call("", "listSshAliases"), ["devbox", "gpu"]);
	await channel.call("", "retryRemoteHost", "devbox");
	await channel.call("", "retryRemoteHost", { alias: "not a string" });

	assert.deepEqual(retried, ["devbox"]);
});
