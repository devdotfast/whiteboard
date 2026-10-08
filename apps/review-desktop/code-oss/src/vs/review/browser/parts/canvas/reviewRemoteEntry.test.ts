import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewApiSummary } from "../../../common/reviewProtocol.js";
import { remoteEntry, withRemoteEntry } from "./reviewRemoteEntry.js";

const available = { sourceWindows: false, languageFeatures: false };
const entry = (host?: string) => ({ reviewId: "r1", title: "Remote", ...(host && { host, available }) }) as ReviewApiSummary;

test("a review a remote opened before its list entry arrived takes the host once the entry does", () => {
	const mounted = { kind: "api", reviewId: "r1", ...remoteEntry(undefined) };
	assert.equal(mounted.host, undefined);
	assert.equal(withRemoteEntry(mounted, undefined), undefined);

	const updated = withRemoteEntry(mounted, entry("wb-a"));
	assert.deepEqual(updated, { kind: "api", reviewId: "r1", host: "wb-a", available });
	assert.equal(withRemoteEntry(updated!, entry("wb-a")), undefined);

	assert.deepEqual(withRemoteEntry(updated!, { ...entry("wb-a"), hostState: "offline" }), { ...updated, hostState: "offline" });
});

test("a laptop review's entry changes nothing", () => {
	const content: { reviewId: string; host?: string } = { reviewId: "r1" };
	assert.equal(withRemoteEntry(content, entry()), undefined);
});
