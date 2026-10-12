import assert from "node:assert/strict";
import test from "node:test";
import { REVIEW_SIDEBAR_MINIMUM_WIDTH, measuredOnce, sidebarMinimumWidth } from "./reviewSidebarWidth.js";

test("the sidebar is never narrower than the window controls over it", () => {
	// The controls end at 188px: the sidebar keeps them inside, with room.
	assert.ok(sidebarMinimumWidth(188, 0) > 188);
	// Zoomed out, the counter-zoomed controls are wider still.
	assert.ok(sidebarMinimumWidth(240.4, 0) > 240.4);
	// Narrow controls leave the usual minimum.
	assert.equal(sidebarMinimumWidth(100, 0), REVIEW_SIDEBAR_MINIMUM_WIDTH);
});

test("the tabs are measured once, and again only after the zoom or fonts change", () => {
	let measured = 0;
	const tabs = measuredOnce(() => ++measured);

	assert.equal(tabs.get(), 1);
	assert.equal(tabs.get(), 1);
	tabs.stale();
	assert.equal(tabs.get(), 2);
	assert.equal(measured, 2);
});
