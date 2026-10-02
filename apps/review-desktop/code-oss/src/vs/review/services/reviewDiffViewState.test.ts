import assert from "node:assert/strict";
import test from "node:test";
import { ReviewDiffViewStateStorage } from "./reviewDiffViewState.js";
import { URI } from "../../base/common/uri.js";

const key = (file: string, generation: string) => JSON.stringify([
	`review-api-source://review-a/${file}?side=base&version=1&generation=${generation}`,
	`review-api-source://review-a/${file}?side=head&version=1&generation=${generation}`,
]);
function setup() {
	const values = new Map<string, string>();
	const storage = {
		get: (key: string) => values.get(key) ?? "",
		store: (key: string, value: string | number | boolean | object | null | undefined) => { values.set(key, String(value)); },
	};
	return { values, storage, saved: new ReviewDiffViewStateStorage(storage) };
}

test("added structural files restore through the generated empty side", () => {
	const { saved } = setup();
	const added = (generation: string) => {
		const modified = URI.parse(`review-api-source://review-a/added.ts?side=head&version=1&generation=${generation}`);
		const original = URI.from({ scheme: "review-structural-empty", path: "/base/added.ts", query: modified.toString() });
		return JSON.stringify([original.toString(), modified.toString()]);
	};
	saved.set("structural", { scrollState: { top: 70, left: 0 }, activeDiffItemKey: added("old"), docStates: { [added("old")]: { collapsed: true } } });
	const restored = saved.get("structural", [added("new")]);
	assert.equal(restored?.activeDiffItemKey, added("new"));
	assert.equal(restored?.docStates?.[added("new")]?.collapsed, true);
});

test("a new host restores position, active file, folds and selection across model generations", () => {
	const { saved, storage } = setup();
	const before = key("file.ts", "old");
	const after = key("file.ts", "new");
	const selection = { selectionStartLineNumber: 8, selectionStartColumn: 1, positionLineNumber: 9, positionColumn: 4 };
	saved.set("review-a:version-1:diff", {
		scrollState: { top: 850, left: 12 },
		activeDiffItemKey: before,
		docStates: { [before]: { collapsed: true, selections: [selection] }, [key("removed.ts", "old")]: { collapsed: false } },
	});
	const reopened = new ReviewDiffViewStateStorage(storage);
	assert.deepEqual(reopened.get("review-a:version-1:diff", [after]), {
		scrollState: { top: 850, left: 12 },
		activeDiffItemKey: after,
		docStates: { [after]: { collapsed: true, selections: [selection] } },
	});
	assert.equal(reopened.get("review-b:version-1:diff", [after]), undefined);
	assert.equal(reopened.get("review-a:version-2:diff", [after]), undefined);
});

test("removed active files fall back and malformed records do not break the editor", () => {
	const { saved, values } = setup();
	saved.set("comparison", { scrollState: { top: 30, left: 0 }, activeDiffItemKey: key("removed.ts", "1") });
	assert.equal(saved.get("comparison", [key("other.ts", "2")])?.activeDiffItemKey, undefined);
	for (const raw of ["{", JSON.stringify({ version: 2, entries: [] }), JSON.stringify({ version: 1, entries: [{ key: "comparison", state: { scrollState: { top: -1, left: 0 } } }] })]) {
		for (const key of values.keys()) values.set(key, raw);
		assert.equal(saved.get("comparison", []), undefined);
	}
});

test("independent canvas instances retain each other's state and bound old comparisons", () => {
	const { saved, storage } = setup();
	const second = new ReviewDiffViewStateStorage(storage);
	const state = { scrollState: { top: 1, left: 0 } };
	saved.set("first", state);
	second.set("second", state);
	assert.equal(saved.get("second", [])?.scrollState.top, 1);
	assert.equal(second.get("first", [])?.scrollState.top, 1);
	for (let i = 0; i < 50; i++) saved.set(`comparison-${i}`, state);
	assert.equal(saved.get("first", []), undefined);
	assert.equal(saved.get("comparison-49", [])?.scrollState.top, 1);
});
