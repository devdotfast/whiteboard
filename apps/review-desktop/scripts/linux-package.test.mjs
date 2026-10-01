import assert from "node:assert/strict";
import test from "node:test";

import { reviewPackage } from "../code-oss/build/linux/review-package.ts";
import { releaseIdentityFor } from "./release-channel.mjs";

const product = (quality) => ({ quality, ...releaseIdentityFor(quality) });

test("the payload quality must match the version shape", () => {
  assert.throws(
    () => reviewPackage(product("stable"), "1.2.4-preview.20260922.7", "1"),
    /quality "stable" does not match/,
  );
  assert.throws(
    () => reviewPackage(product("preview"), "1.2.4", "1"),
    /quality "preview" does not match/,
  );
  assert.throws(() => reviewPackage(product("stable"), "1.2.4-rc.1", "1"));
  assert.throws(() => reviewPackage(product("stable"), "1.2.4", "0"));
});
