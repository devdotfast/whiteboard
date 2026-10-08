import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { STRUCTURAL_DIFF_WIRE_VERSION } from "./contract.js";
import { repositoryRoot } from "./test-binary.js";

test("STRUCTURAL_DIFF_WIRE_VERSION matches crates/diffr-core/src/protocol/mod.rs", () => {
  const source = readFileSync(join(repositoryRoot, "crates/diffr-core/src/protocol/mod.rs"), "utf8");
  const match = /pub const VERSION: u32 = (\d+);/.exec(source);
  expect(match).not.toBeNull();
  expect(Number(match![1])).toBe(STRUCTURAL_DIFF_WIRE_VERSION);
});

test("package version matches the Cargo version", () => {
  const pkg = JSON.parse(readFileSync(join(repositoryRoot, "diffr-ts/package.json"), "utf8"));
  const cargo = readFileSync(join(repositoryRoot, "Cargo.toml"), "utf8");
  expect(/^version = "([^"]+)"/m.exec(cargo)?.[1]).toBe(pkg.version);
});
