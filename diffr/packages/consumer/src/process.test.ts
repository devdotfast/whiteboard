import { expect, test } from "bun:test";
import { openComparison } from "./process";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadBundledTheme } from "@diffr/viewer/theme/themes";

test("a saved comparison streams into an interactive pane", async () => {
  const comparison = await openComparison({ cwd: process.cwd(), input: fileURLToPath(new URL("../../claude-code/test/fixtures/scopes.ndjson", import.meta.url)) });
  await comparison.done;
  expect(comparison.store.getSnapshot().errors).toEqual([]);
  expect(comparison.store.getSnapshot().files.length).toBeGreaterThan(0);
  expect(comparison.pane.frame({ columns: 80, rows: 24 }).lines).toHaveLength(24);
  comparison.dispose();
  comparison.dispose();
});

test("missing recordings report a store error without rejecting the background pump", async () => {
  const comparison = await openComparison({ cwd: process.cwd(), input: "/nonexistent/diffr-consumer-recording.ndjson" });
  await comparison.done;
  expect(comparison.store.getSnapshot().errors.join(" ")).toContain("ENOENT");
  comparison.dispose();
});

test("recording paths are relative to the reviewed directory", async () => {
  const cwd = fileURLToPath(new URL("../../claude-code/test/fixtures/", import.meta.url));
  const comparison = await openComparison({ cwd, input: "scopes.ndjson" });
  await comparison.done;
  expect(comparison.store.getSnapshot().files.length).toBeGreaterThan(0);
  expect(comparison.store.getSnapshot().errors).toEqual([]);
  comparison.dispose();
});

test("subprocess failures reach the pane and disposal terminates a live producer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "diffr-consumer-process-"));
  const binary = join(dir, "producer");
  const theme = loadBundledTheme("default-dark");
  try {
    await writeFile(binary, "#!/bin/sh\necho 'comparison unavailable' >&2\nexit 2\n", { mode: 0o755 });
    const failed = await openComparison({ cwd: dir, binary, theme });
    await failed.done;
    expect(failed.store.getSnapshot().errors.join(" ")).toContain("comparison unavailable");
    failed.dispose();
    await writeFile(binary, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
    const active = await openComparison({ cwd: dir, binary, theme });
    active.dispose();
    await active.done;
    expect(active.store.getSnapshot().errors).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 3000);
