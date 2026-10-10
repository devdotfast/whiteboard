import assert from "node:assert/strict";
import test from "node:test";

import { Emitter } from "../../base/common/event.js";
import { observableValue, transaction } from "../../base/common/observable.js";
import type { ReviewDiffLayout } from "../common/reviewProtocol.js";
import type { ReviewDiffLayoutSetting } from "./reviewDiffLayout.js";
import {
	bindDocumentDiffLayout,
	type DocumentDiffLayoutItem,
} from "./reviewDocumentDiffLayout.js";

test("identical documents collapse and changed or pending documents follow the preference", () => {
	const changes = new Emitter<ReviewDiffLayout>();
	let preference: ReviewDiffLayout = "split";
	const layout = {
		get: () => preference,
		onDidChange: changes.event,
	} as ReviewDiffLayoutSetting;
	const isDiffUpToDate = observableValue("ready", false);
	const diff = observableValue<
		{ identical: boolean; quitEarly: boolean } | undefined
	>("diff", undefined);
	const item = { isDiffUpToDate, diff };
	const items = observableValue<
		readonly (DocumentDiffLayoutItem | undefined)[]
	>("items", []);
	let split: boolean | undefined;
	const binding = bindDocumentDiffLayout(layout, items, (value) => {
		split = value;
	});
	try {
		assert.equal(
			split,
			true,
			"an empty/loading view must not count as identical",
		);
		items.set([item], undefined);
		assert.equal(split, true);
		transaction((tx) => {
			diff.set({ identical: true, quitEarly: false }, tx);
			isDiffUpToDate.set(true, tx);
		});
		assert.equal(split, false);
		preference = "unified";
		changes.fire(preference);
		preference = "split";
		changes.fire(preference);
		assert.equal(
			split,
			false,
			"choosing split must not duplicate identical documents",
		);
		isDiffUpToDate.set(false, undefined);
		assert.equal(
			split,
			true,
			"a stale identical result must not collapse a changed document",
		);
		transaction((tx) => {
			diff.set({ identical: false, quitEarly: false }, tx);
			isDiffUpToDate.set(true, tx);
		});
		assert.equal(split, true);
		preference = "unified";
		changes.fire(preference);
		assert.equal(
			split,
			false,
			"changed documents still respect the unified preference",
		);
		preference = "split";
		changes.fire(preference);
		diff.set({ identical: true, quitEarly: true }, undefined);
		assert.equal(
			split,
			true,
			"an incomplete comparison must not count as identical",
		);
		diff.set({ identical: true, quitEarly: false }, undefined);
		items.set([item, undefined], undefined);
		assert.equal(
			split,
			true,
			"missing sides and non-text entries must not collapse",
		);
		items.set([item], undefined);
		assert.equal(split, false);
	} finally {
		binding.dispose();
		changes.dispose();
	}
});
