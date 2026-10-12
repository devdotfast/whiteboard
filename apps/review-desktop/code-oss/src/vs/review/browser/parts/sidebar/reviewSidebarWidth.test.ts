import assert from "node:assert/strict";
import test from "node:test";
import { REVIEW_SIDEBAR_MINIMUM_WIDTH, sidebarMinimumWidth } from "./reviewSidebarWidth.js";

test("the sidebar is never narrower than the window controls over it", () => {
	// The controls end at 188px: the sidebar keeps them inside, with room.
	assert.ok(sidebarMinimumWidth(188, 0) > 188);
	// Zoomed out, the counter-zoomed controls are wider still.
	assert.ok(sidebarMinimumWidth(240.4, 0) > 240.4);
	// Narrow controls leave the usual minimum.
	assert.equal(sidebarMinimumWidth(100, 0), REVIEW_SIDEBAR_MINIMUM_WIDTH);
});
