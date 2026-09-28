import assert from "node:assert/strict";
import test from "node:test";

import { darwinTarget, updateZipName } from "./release-channel.mjs";

test("darwinTarget names the macOS release target for each Node arch", () => {
  assert.equal(darwinTarget("arm64"), "darwin-arm64");
  assert.equal(darwinTarget("x64"), "darwin-x64");
  assert.throws(() => darwinTarget("ia32"), /unsupported macOS arch ia32/);
});

test("updateZipName carries the target", () => {
  assert.equal(
    updateZipName("Whiteboard", "1.2.3", "darwin-x64"),
    "Whiteboard-darwin-x64-1.2.3.zip",
  );
});
