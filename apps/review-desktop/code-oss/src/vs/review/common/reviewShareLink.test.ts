/*---------------------------------------------------------------------------------------------
 *  Copyright (c) dev.fast. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import test from "node:test";

import { shareUrlFromDeepLink } from "./reviewShareLink.js";

test("a share deep link keeps its origin and revision", () => {
	const t = "a".repeat(43),
		rev = "5b0e9a52-4a43-4f7e-9d8e-3c1f0e7b2a11";
	assert.equal(
		shareUrlFromDeepLink(`/${t}`, `origin=${encodeURIComponent("https://stg.dev.fast")}&rev=${rev}`),
		`https://stg.dev.fast/s/${t}?rev=${rev}`,
	);
	assert.equal(shareUrlFromDeepLink(`/${t}`, ""), `https://app.dev.fast/s/${t}`);
});
