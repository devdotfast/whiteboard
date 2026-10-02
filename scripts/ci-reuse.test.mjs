import assert from "node:assert/strict";
import test from "node:test";

import { findReusableRun } from "./ci-reuse.mjs";

function fixture({ artifact = {}, run = {}, caches, failure } = {}) {
  const calls = [];

  return {
    calls,
    options: {
      tree: "tree-a",
      runId: "20",
      cacheKeys: ["code-oss", "playwright"],
      api: async (path) => {
        calls.push(path);

        if (failure) throw new Error("API unavailable");

        if (path.startsWith("artifacts?")) {
          return {
            artifacts: [
              {
                name: "ci-tree-tree-a",
                expired: false,
                workflow_run: { id: 10 },
                ...artifact,
              },
            ],
          };
        }

        if (path === "runs/20") return { workflow_id: 1 };

        if (path === "runs/10")
          return {
            workflow_id: 1,
            status: "completed",
            conclusion: "success",
            event: "pull_request",
            html_url: "https://github.com/example/repo/actions/runs/10",
            ...run,
          };

        if (path.startsWith("caches?")) {
          const key = new URLSearchParams(path.split("?")[1]).get("key");

          return {
            actions_caches: caches ?? [{ key, ref: "refs/heads/main" }],
          };
        }

        throw new Error(`Unexpected API request: ${path}`);
      },
    },
  };
}

test("reuses a completed successful run for the tree with both main caches", async () => {
  const { options, calls } = fixture();
  assert.equal(
    await findReusableRun(options),
    "https://github.com/example/repo/actions/runs/10",
  );
  assert.equal(calls.filter((path) => path.startsWith("caches?")).length, 2);
});

test("runs full CI when no receipt exists", async () => {
  const { options } = fixture();

  options.api = async () => ({ artifacts: [] });
  assert.equal(await findReusableRun(options), undefined);
});

for (const [name, overrides] of Object.entries({
  "different tree": { artifact: { name: "ci-tree-tree-b" } },
  "expired receipt": { artifact: { expired: true } },
  "current run": { artifact: { workflow_run: { id: 20 } } },
  "different workflow": { run: { workflow_id: 2 } },
  "pending run": { run: { status: "in_progress", conclusion: null } },
  "failed run": { run: { conclusion: "failure" } },
  "cancelled run": { run: { conclusion: "cancelled" } },
  "missing caches": { caches: [] },
  "missing Playwright cache": {
    caches: [{ key: "code-oss", ref: "refs/heads/main" }],
  },
  "PR-scoped cache": {
    caches: [{ key: "code-oss", ref: "refs/pull/1/merge" }],
  },
  "prefix-only cache match": {
    caches: [{ key: "code-oss-old", ref: "refs/heads/main" }],
  },
  "API failure": { failure: true },
})) {
  test(`runs full CI for ${name}`, async () => {
    assert.equal(await findReusableRun(fixture(overrides).options), undefined);
  });
}
