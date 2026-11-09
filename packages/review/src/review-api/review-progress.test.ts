import { UNCATEGORIZED_LENS_ID } from "@dev.fast/whiteboard-document";
import { expect, it } from "vitest";

import { pendingLenses } from "./review-progress.js";

const source = { side: "head" as const, file: "a.ts", fromLine: 1, toLine: 2 };

const lenses = [
  {
    id: "stale",
    title: "Stale",
    sources: [],
    unavailable: "Source links need updating at these pins",
  },
  {
    id: "empty",
    title: "Empty",
    sources: [],
    fileCount: 0,
    wholeFiles: true,
    unavailable: "No files match these targets",
  },
  {
    id: UNCATEGORIZED_LENS_ID,
    title: "Uncategorized changes",
    sources: [source],
    fileCount: 1,
    wholeFiles: false,
  },
];

it("waits on counted lenses while counting but leaves a lens whose anchors threw as it is", () => {
  const [stale, empty, uncategorized] = pendingLenses(lenses, true);

  expect(stale).toEqual(lenses[0]);
  expect(stale).not.toHaveProperty("pending");
  expect(empty).toMatchObject({ pending: true, unavailable: undefined });
  expect(uncategorized).toMatchObject({
    sources: [],
    fileCount: 0,
    pending: true,
    unavailable: undefined,
  });
});

it("leaves every lens as resolved once counted", () => {
  const [stale, empty, uncategorized] = pendingLenses(lenses, false);

  expect(stale).not.toHaveProperty("pending");
  expect(empty).toEqual({ ...lenses[1], pending: false });
  expect(uncategorized).toEqual({ ...lenses[2], pending: false });
});
