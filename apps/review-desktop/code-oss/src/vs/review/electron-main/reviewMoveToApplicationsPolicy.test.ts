/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";

import { shouldOfferMoveToApplications, type MoveToApplicationsContext } from "./reviewMoveToApplicationsPolicy.js";

const outsideApplications: MoveToApplicationsContext = {
	platform: "darwin",
	isBuilt: true,
	inApplicationsFolder: false,
	declined: false,
	env: {},
};

test("a packaged macOS app outside Applications offers the move", () => {
	assert.equal(shouldOfferMoveToApplications(outsideApplications), true);
});

test("an app already in Applications, or one whose user declined, is left alone", () => {
	assert.equal(shouldOfferMoveToApplications({ ...outsideApplications, inApplicationsFolder: true }), false);
	assert.equal(shouldOfferMoveToApplications({ ...outsideApplications, declined: true }), false);
});

test("dev builds and other platforms never offer the move", () => {
	assert.equal(shouldOfferMoveToApplications({ ...outsideApplications, isBuilt: false }), false);
	assert.equal(shouldOfferMoveToApplications({ ...outsideApplications, platform: "linux" }), false);
});

test("background, test-harness and CI launches wait for a normal launch", () => {
	for (const env of [
		{ DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1" },
		{ DEV_FAST_REVIEW_TELEMETRY_ENV: "e2e" },
		{ DEV_FAST_REVIEW_TELEMETRY_ENV: "smoke" },
		{ CI: "true" },
	]) {
		assert.equal(shouldOfferMoveToApplications({ ...outsideApplications, env }), false, JSON.stringify(env));
	}
});
