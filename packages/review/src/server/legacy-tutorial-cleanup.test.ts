import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ReviewStore } from "@review/review-api/store.js";
import { expect, it } from "vitest";

import { removeLegacyTutorial } from "./legacy-tutorial-cleanup.js";

const providers = {
  validatePins: async () => {},
  validateSource: async () => {},
  validateResource: async () => {},
};

const pins = { repositoryId: "repo", base: "base", head: "head" };

it("deletes the tutorial an earlier version left, out of Trash or in it, and leaves other boards", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "legacy-tutorial-"));
  const file = path.join(directory, "review-api.db");
  const tutorialRoot = path.join(directory, "tutorial");
  await mkdir(tutorialRoot);

  const created = new ReviewStore(file, providers);

  const board = async (title: string) =>
    (
      await created.execute({
        operation: {
          type: "create",
          title,
          target: { kind: "commits", ...pins },
        },
      })
    ).reviewId;

  const tutorial = await board("Tutorial");
  const trashed = await board("Tutorial, in Trash");
  const kept = await board("Plan");

  await created.execute({
    operation: { type: "lifecycle", reviewId: trashed, state: "trash" },
  });
  await created.close();

  // As an earlier version stored its tutorial.
  const db = new DatabaseSync(file);
  db.prepare(
    "UPDATE versions SET snapshot=json_set(snapshot,'$.origin.tutorial',1) WHERE review_id IN (?,?)",
  ).run(tutorial, trashed);
  db.close();

  const store = new ReviewStore(file, providers);
  const forgotten: string[] = [];

  try {
    await removeLegacyTutorial({
      store,
      data: {
        forgetRepository: async (id: string) => void forgotten.push(id),
      },
      root: tutorialRoot,
    });

    expect(store.list().map((summary) => summary.reviewId)).toEqual([kept]);
    expect(store.has(tutorial)).toBe(false);
    expect(store.has(trashed)).toBe(false);
    expect(forgotten).toEqual([]);
  } finally {
    await store.close();
  }
});
