/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewSshPromptEvent } from "../../common/reviewSshPrompt.js";
import { ReviewSshPromptRelay } from "./reviewSshPromptRelay.js";

const request = { alias: "wb-test-a", text: "dev@127.0.0.1's password: ", kind: "secret" as const };

function relayWithWindow(windowWaitMs = 1000) {
	const relay = new ReviewSshPromptRelay(windowWaitMs);
	const events: ReviewSshPromptEvent[] = [];
	const window = relay.onPrompt((event) => events.push(event));
	return { relay, events, window };
}

test("a window gets the prompt and its answer resolves it", async () => {
	const { relay, events } = relayWithWindow();

	const answer = relay.prompt(request);
	const [shown] = events;
	assert.ok(shown && !("closed" in shown));
	assert.equal(shown.alias, "wb-test-a");
	relay.answer(shown.id, "hunter2");

	assert.equal(await answer, "hunter2");
	assert.deepEqual(events.at(-1), { id: shown.id, closed: true });
	relay.dispose();
});

test("with no window, the prompt waits for one", async () => {
	const relay = new ReviewSshPromptRelay(1000);
	const answer = relay.prompt(request);

	const events: ReviewSshPromptEvent[] = [];
	relay.onPrompt((event) => {
		events.push(event);
		if (!("closed" in event)) relay.answer(event.id, "late");
	});

	assert.equal(await answer, "late");
	relay.dispose();
});

test("with no window for the whole wait, the prompt is cancelled", async () => {
	const relay = new ReviewSshPromptRelay(20);
	assert.equal(await relay.prompt(request), undefined);
	relay.dispose();
});

test("an abandoned prompt is closed in the window", async () => {
	const { relay, events } = relayWithWindow();
	const abort = new AbortController();

	const answer = relay.prompt({ ...request, signal: abort.signal });
	abort.abort();

	assert.equal(await answer, undefined);
	assert.ok(events.some((event) => "closed" in event));
	relay.dispose();
});

test("a prompt open in a window that reloads is shown to the reloaded window", async () => {
	const relay = new ReviewSshPromptRelay(1000);
	const first: ReviewSshPromptEvent[] = [];
	const window = relay.onPrompt((event) => first.push(event));
	const answer = relay.prompt(request);
	assert.equal(first.length, 1);

	window.dispose();
	const second: ReviewSshPromptEvent[] = [];
	relay.onPrompt((event) => second.push(event));
	const [shown] = second;
	assert.ok(shown && !("closed" in shown));
	assert.equal(shown.id, first[0].id);
	relay.answer(shown.id, "late");

	assert.equal(await answer, "late");
	relay.dispose();
});
