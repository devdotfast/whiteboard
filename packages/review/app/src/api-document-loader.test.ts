import type { ReviewApiClient } from "@review/review-api/client";
import { documentSchema } from "@review/review-api/document";
import type { Snapshot } from "@review/review-api/store";
import { expect, it } from "vitest";

import { createDocumentLoader } from "./api-document";
import { createCanvasQueryClient } from "./canvas-query";

const board = (markdown: string): Snapshot => ({
  reviewId: "loader-cache",
  version: 3,
  title: "Board",
  createdAt: "today",
  document: documentSchema.parse([{ id: "prose", type: "markdown", markdown }]),
});

// SAFETY: a board without pins or resources makes no requests.
const client = {} as ReviewApiClient;

it("reuses a board's parsed Markdown when it is opened again", async () => {
  const markdown = "## Why\n\nSee [the entry](review-source:head/src/a.ts#L1).";

  const first = await createDocumentLoader(
    client,
    createCanvasQueryClient(),
  ).load(board(markdown));

  expect(first.headings.entries.map((heading) => heading.text)).toEqual([
    "Why",
  ]);
  expect([...first.anchors.keys()]).toHaveLength(1);

  // Each open makes a new loader and receives a freshly parsed snapshot.
  const again = await createDocumentLoader(
    client,
    createCanvasQueryClient(),
  ).load(board(markdown));

  expect(again.headings).toBe(first.headings);

  // The same version id with other content is not mistaken for it.
  const edited = await createDocumentLoader(
    client,
    createCanvasQueryClient(),
  ).load(board("## Instead\n\nNo sources."));

  expect(edited.headings.entries.map((heading) => heading.text)).toEqual([
    "Instead",
  ]);
  expect(edited.anchors.size).toBe(0);
});
