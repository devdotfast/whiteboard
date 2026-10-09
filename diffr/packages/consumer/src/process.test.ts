import { expect, test } from "vitest";
import { openComparison } from "./process";
import { fileURLToPath } from "node:url";

test("a saved comparison streams into an interactive pane", async () => {
  const comparison = await openComparison({ cwd: process.cwd(), input: fileURLToPath(new URL("../test/fixtures/scopes.ndjson", import.meta.url)) });
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
