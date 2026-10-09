import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { openComparison } from "./process";
import { opened } from "./open-tool";

test("tool acknowledgement waits for a valid manifest and reports producer failures", async () => {
  const good = await openComparison({ cwd: process.cwd(), input: fileURLToPath(new URL("../test/fixtures/scopes.ndjson", import.meta.url)) });
  try { expect(await opened(good)).toContain("changed files"); } finally { good.dispose(); }
  const missing = await openComparison({ cwd: process.cwd(), input: "/nonexistent/diffr-tool.ndjson" });
  try { await expect(opened(missing)).rejects.toThrow("ENOENT"); } finally { missing.dispose(); }
});

test("an already cancelled open cannot report success", async () => {
  const comparison = await openComparison({ cwd: process.cwd(), input: "/nonexistent/diffr-tool.ndjson" });
  try { await expect(opened(comparison, AbortSignal.abort())).rejects.toThrow("cancelled"); }
  finally { comparison.dispose(); await comparison.done; }
});
