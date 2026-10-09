import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  STRUCTURAL_DIFF_WIRE_VERSION,
  type StructuralDiffEvent,
  decodeStructuralDiffEvent,
} from "./index.js";
import { diffrBinary, repositoryRoot } from "./test-binary.js";

// These tests run the debug binary. Its first run compiles the bundled plugins
// into an empty wasmtime cache, which is slow on CI runners.
vi.setConfig({ testTimeout: 30_000 });

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], cwd = repositoryRoot): StructuralDiffEvent[] {
  const result = spawnSync(diffrBinary(), args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, XDG_CONFIG_HOME: tempDir("diffr-config-") },
  });
  expect(result.status, result.stderr).toBe(0);
  const lines = result.stdout.split("\n").filter((line) => line.length > 0);
  expect(lines.length).toBeGreaterThan(0);
  return lines.map(decodeStructuralDiffEvent);
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
}

const pairs: [string, string][] = [
  ["sample_files/simple_1.js", "sample_files/simple_2.js"],
  ["sample_files/if_1.py", "sample_files/if_2.py"],
  ["sample_files/context_1.rs", "sample_files/context_2.rs"],
  ["sample_files/comments_1.rs", "sample_files/comments_2.rs"],
];

describe("every record the binary writes validates", () => {
  for (const [before, after] of pairs) {
    test(`--no-index ${before} ${after}`, () => {
      const events = run(["--no-index", "--format", "ndjson", "--", before, after]);
      expect(events[0]).toMatchObject({ type: "start", version: STRUCTURAL_DIFF_WIRE_VERSION });
      expect(events.at(-1)).toMatchObject({ type: "complete", failed: 0 });
      expect(events.some((event) => event.type === "file")).toBe(true);
    });
  }

  test("--syntax adds syntax spans that validate", () => {
    const events = run(["--no-index", "--syntax", "--format", "ndjson", "--", ...pairs[2]]);
    const file = events.find((event) => event.type === "file");
    expect(file?.diff && file.diff.type === "text" && (file.diff.rhs?.syntax?.length ?? 0) > 0).toBe(true);
  });

  test("repository comparisons emit finished v3 file records", () => {
    const root = tempDir("diffr-contract-repo-");
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "test");
    writeFileSync(join(root, "lib.rs"), "fn a() -> u32 {\n    1\n}\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "one");
    writeFileSync(join(root, "lib.rs"), "fn a() -> u32 {\n    2\n}\n\nfn b() -> u32 {\n    a() + 1\n}\n");
    git(root, "commit", "-q", "-am", "two");

    const events = run(["--repo", root, "--format", "ndjson", "HEAD~1", "HEAD"], root);
    expect(events[0]).toMatchObject({ type: "start", version: STRUCTURAL_DIFF_WIRE_VERSION });
    expect(events.some((event) => event.type === "file")).toBe(true);
    expect(events.map((event) => event.type)).toEqual(["start", "file", "complete"]);
    expect(events.at(-1)).toMatchObject({ type: "complete", failed: 0 });
  });
});

test("the terminal UI's committed v3 fixture still validates", () => {
  const text = readFileSync(join(repositoryRoot, "packages/tui/test/fixtures/comparison.ndjson"), "utf8");
  const events = text.split("\n").filter((line) => line.length > 0).map(decodeStructuralDiffEvent);
  expect(events[0]).toMatchObject({ type: "start", version: STRUCTURAL_DIFF_WIRE_VERSION });
  expect(events.at(-1)).toMatchObject({ type: "complete", failed: 0 });
});

test("a record missing required fields is rejected", () => {
  expect(() => decodeStructuralDiffEvent('{"type":"complete","succeeded":1}')).toThrow(
    "Malformed diffr protocol record.",
  );
});

test("removed annotation records are rejected", () => {
  const record = {
    type: "annotations",
    file: { rhs: { path: "a.rs", oid: "", mode: "" } },
    annotations: [{ region_id: 1, label: "do work" }],
  };
  expect(() => decodeStructuralDiffEvent(JSON.stringify(record))).toThrow(
    "Malformed diffr protocol record.",
  );
});

test("invalid JSON preserves the parse failure as its cause", () => {
  try {
    decodeStructuralDiffEvent("{");
    throw new Error("expected decoding to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Malformed diffr protocol record.");
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  }
});
