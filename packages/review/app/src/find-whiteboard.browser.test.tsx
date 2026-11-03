import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { mountReviewFinder } from "./desktop-entry";
import { finderCatalog, finderRows } from "./find-whiteboard-model";

const board = (overrides: Partial<ReviewApiSummary>): ReviewApiSummary => ({
  reviewId: "board",
  version: 0,
  title: "Board",
  createdAt: "2026-09-20T12:00:00Z",
  repositoryName: "app",
  viewedAt: null,
  trashedAt: null,
  ...overrides,
});

const boards = [
  board({
    reviewId: "pr",
    title: "Resolve branch identity",
    createdAt: "2026-09-22T12:00:00Z",
    origin: { branch: "fix/identity", pullRequestNumber: 1289 },
    repositoryPath: "/w/whiteboard-identity",
  }),
  board({
    reviewId: "plan",
    title: "Theming plan",
    createdAt: "2026-09-21T12:00:00Z",
    origin: { branch: "feat/theming" },
  }),
  board({
    reviewId: "old",
    title: "Old notes",
    createdAt: "2026-09-01T12:00:00Z",
    viewedAt: "2026-09-23T12:00:00Z",
  }),
];

const mounted: ReturnType<typeof mountReviewFinder>[] = [];

afterEach(() => {
  for (const handle of mounted.splice(0)) handle.dispose();
  document.body.replaceChildren();
});

async function mount() {
  const container = document.createElement("div");

  document.body.append(container);
  const onOpen = vi.fn<(reviewId: string) => void>();
  const onClose = vi.fn<() => void>();

  await act(async () => {
    mounted.push(mountReviewFinder(container, { boards, onOpen, onClose }));
  });

  const rows = () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(
      (row) => row.textContent,
    );

  const picked = () =>
    document.querySelector<HTMLElement>('[aria-selected="true"]')?.textContent;

  return { onOpen, onClose, rows, picked };
}

it("lists boards touched last first and focuses the search", async () => {
  const { rows } = await mount();

  expect(rows().map((row) => row?.slice(0, 8))).toEqual([
    "Old note",
    "Resolve ",
    "Theming ",
  ]);
  expect(document.activeElement).toBe(document.querySelector("input"));
});

it("narrows by branch and PR number and opens the picked row on Enter", async () => {
  const { rows, onOpen } = await mount();

  await userEvent.keyboard("theming");
  expect(rows()).toHaveLength(1);
  expect(rows()[0]).toContain("Theming plan");

  await userEvent.clear(document.querySelector("input")!);
  await userEvent.keyboard("1289");
  expect(rows()).toHaveLength(1);
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("pr");
});

it("moves the pick with the arrows, wrapping, and opens on click", async () => {
  const { picked, onOpen } = await mount();

  expect(picked()).toContain("Old notes");
  await userEvent.keyboard("{ArrowDown}");
  expect(picked()).toContain("Resolve branch identity");
  await userEvent.keyboard("{ArrowUp}{ArrowUp}");
  expect(picked()).toContain("Theming plan");
  await userEvent.click(document.querySelector('[role="option"]')!);
  expect(onOpen).toHaveBeenCalledWith("old");
});

it("closes on Escape and says when nothing matches", async () => {
  const { onClose, rows } = await mount();

  await userEvent.keyboard("zzzz");
  expect(rows()).toHaveLength(0);
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "No whiteboards match",
  );
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => onClose.mock.calls.length).toBe(1);
});

it("ranks a title hit over a branch hit", () => {
  const ranked = finderRows(
    finderCatalog([
      board({
        reviewId: "branch",
        title: "Zebra",
        createdAt: "2026-09-25T12:00:00Z",
        origin: { branch: "feat/theming" },
      }),
      board({ reviewId: "title", title: "Theming" }),
    ]),
    "theming",
  );

  expect(ranked.map((row) => row.reviewId)).toEqual(["title", "branch"]);
});
