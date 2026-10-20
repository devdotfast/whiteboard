import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewApiSummary } from "../common/reviewProtocol.js";
import { openChildWhiteboard } from "./reviewChildWhiteboard.js";

const parent: ReviewApiSummary = { reviewId: "plan", title: "Plan", version: 1, repositoryPath: "/repo", repositoryName: "repo", createdAt: "2026-10-20T00:00:00Z", viewedAt: null, trashedAt: null };

test("creates the same project child and discards only that new child when opening fails", async () => {
  const created: unknown[] = [];
  const discarded: string[] = [];
  const failure = new Error("Cannot open tab");
  const catalog = { reviews: [parent], createReview: async (path: string, parentId?: string) => { created.push([path, parentId]); return "new-child"; }, discardReview: async (id: string) => { discarded.push(id); return true; } };
  await assert.rejects(openChildWhiteboard(catalog, { openApiReview: async () => { throw failure; } }, "plan"), (error) => error === failure);
  assert.deepEqual(created, [["/repo", "plan"]]);
  assert.deepEqual(discarded, ["new-child"]);
  const opened: unknown[] = [];
  await openChildWhiteboard(catalog, { openApiReview: async (id, title) => { opened.push([id, title]); } }, "plan");
  assert.deepEqual(opened, [["new-child", "Untitled"]]);
  assert.deepEqual(discarded, ["new-child"]);
});

test("rejects nested, trashed, remote and missing parents before creating anything", async () => {
  for (const board of [undefined, { ...parent, parentId: "other" }, { ...parent, trashedAt: "2026-10-20T00:00:00Z" }, { ...parent, host: "remote" }]) {
    let created = false;
    const catalog = { reviews: board ? [board] : [], createReview: async () => { created = true; return "wrong"; }, discardReview: async () => true };
    await assert.rejects(openChildWhiteboard(catalog, { openApiReview: async () => {} }, "plan"), /no longer available/);
    assert.equal(created, false);
  }
});
