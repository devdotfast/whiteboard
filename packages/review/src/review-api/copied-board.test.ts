import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type Block,
  ReviewInputError,
  rangeAnchor,
} from "@dev.fast/whiteboard-document";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { type ReviewProviders, ReviewStore, type Seed } from "./store.js";

const pins = {
  repositoryId: "local",
  base: "a".repeat(40),
  head: "b".repeat(40),
};

let directory: string, store: ReviewStore;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "review-copied-"));
  vi.stubEnv("DEV_REVIEW_HOME", directory);
  store = new ReviewStore(path.join(directory, "reviews.db"), {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: vi.fn<ReviewProviders["validateResource"]>(
      async (_pins, block) => {
        if (block.type === "image")
          throw new ReviewInputError("Resource not found.", 404);
      },
    ),
  });
});

afterEach(async () => {
  await store.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

const peek = (repositoryId: string): Block => ({
  id: "code_peek-7",
  type: "code_peek",
  source: rangeAnchor({ side: "head", file: "a.ts", fromLine: 1, toLine: 2 }),
  pins: { repositoryId, head: pins.head },
});

const seed: Seed = {
  document: [
    { id: "markdown-3", type: "markdown", markdown: "Why" },
    peek("sender"),
    { id: "image-9", type: "image", assetId: "missing", alt: "Chart" },
  ],
  lenses: [
    {
      id: "lens-12",
      title: "Core",
      targets: [{ kind: "files", patterns: ["src/**"] }],
    },
  ],
  origin: { branch: "feature" },
  shared: {
    login: "ada",
    sharedAt: 1,
    cloneUrl: "https://github.com/o/r",
    key: "link",
  },
};

const copy = () =>
  store.execute(
    {
      operation: {
        type: "create",
        title: "Copy",
        target: { kind: "commits", ...pins },
      },
    },
    structuredClone(seed),
  );

it("keeps a copied board's blocks, lenses and provenance, reading in its own repository", async () => {
  const { reviewId } = await copy();
  const snapshot = store.read(reviewId);

  expect(snapshot.document).toEqual([
    seed.document[0],
    peek("local"),
    seed.document[2],
  ]);
  expect(snapshot.lenses).toEqual(seed.lenses);
  expect(snapshot.shared).toEqual(seed.shared);
  expect(snapshot.origin?.branch).toBe("feature");

  const { targetId } = await store.execute({
    operation: {
      type: "edit",
      reviewId,
      edit: { type: "insert", content: { type: "divider" } },
    },
  });

  expect(targetId).toBe("block-13");
});

it("finds a copy by its link until it is deleted", async () => {
  const { reviewId } = await copy();

  expect(store.copyOf("link")).toBe(reviewId);
  expect(store.copyOf("other")).toBeUndefined();

  await store.execute(
    { operation: { type: "lifecycle", state: "trash", reviewId } },
    undefined,
    { kind: "person" },
  );
  expect(store.copyOf("link")).toBe(reviewId);

  await store.execute({ operation: { type: "delete", reviewId } }, undefined, {
    kind: "person",
  });
  expect(store.copyOf("link")).toBeUndefined();
});

it("still checks the images of a board made from scratch", async () => {
  const { reviewId } = await store.execute({
    operation: {
      type: "create",
      title: "Own",
      target: { kind: "commits", ...pins },
    },
  });

  await expect(
    store.execute({
      operation: {
        type: "edit",
        reviewId,
        edit: {
          type: "insert",
          content: { type: "image", assetId: "missing", alt: "Chart" },
        },
      },
    }),
  ).rejects.toThrow("Resource not found.");
});
