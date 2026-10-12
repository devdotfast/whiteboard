import type {
  ReviewApiSummary,
  ReviewSidebarSectionProps,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { mountReviewSidebarSection } from "./desktop-entry";

const board = (overrides: Partial<ReviewApiSummary>): ReviewApiSummary => ({
  reviewId: "board",
  version: 0,
  title: "Board",
  createdAt: "2026-09-20T12:00:00Z",
  repositoryName: "app",
  viewedAt: null,
  trashedAt: null,
  changed: false,
  ...overrides,
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const props = (
  overrides: Partial<ReviewSidebarSectionProps>,
): ReviewSidebarSectionProps => ({
  section: "whiteboards",
  connection: { serverUrl: "http://review.test", token: "t" },
  reviewId: "pr",
  contents: [],
  onOpenBoard: () => {},
  onOpenHeading: () => {},
  ...overrides,
});

const day = (n: number) => `2026-09-${String(n).padStart(2, "0")}T12:00:00Z`;

const mount = async (initial: ReviewSidebarSectionProps) => {
  const container = document.createElement("div");

  document.body.append(container);
  let handle: ReturnType<typeof mountReviewSidebarSection> | undefined;

  await act(async () => {
    handle = mountReviewSidebarSection(container, initial);
  });

  /** Each row's text, a child's indented under its parent; a changed
   * board's ends in "•". */
  const rows = () =>
    [...container.querySelectorAll<HTMLElement>("li")].map((row) => {
      const main = [
        ...row.querySelectorAll(":scope > div > button, :scope > button"),
      ].at(-1)!;

      const nested = row.parentElement!.closest("li") ? "  " : "";
      const changed = main.querySelector("[data-changed]") ? " •" : "";

      return nested + main.textContent + changed;
    });

  const click = (selector: string) =>
    act(async () => container.querySelector<HTMLElement>(selector)!.click());

  return {
    rows,
    click,
    update: (next: ReviewSidebarSectionProps) =>
      act(async () => handle!.update(next)),
    dispose: () => act(async () => handle!.dispose()),
  };
};

it("shows the five latest top-level boards, a parent ranked by its newest member", async () => {
  const project = {
    project: { id: "caps", name: "acme/caps" },
    boards: [
      ...Array.from({ length: 7 }, (_, index) =>
        board({
          reviewId: `b${index + 1}`,
          title: `Board ${index + 1}`,
          createdAt: day(20 - index),
        }),
      ),
      // An old parent whose child changed last.
      board({
        reviewId: "plan",
        title: "Plan",
        createdAt: day(1),
        children: ["s1", "s2"],
      }),
      board({
        reviewId: "s1",
        title: "Step 1",
        parentId: "plan",
        createdAt: day(25),
      }),
      board({
        reviewId: "s2",
        title: "Step 2",
        parentId: "plan",
        createdAt: day(2),
      }),
    ],
  };

  const view = await mount(props({ reviewId: "b7", project }));

  // Collapsed, the parent is one row; the open board shows wherever it falls.
  await vi.waitFor(() =>
    expect(view.rows()).toEqual([
      "Plan",
      "Board 1",
      "Board 2",
      "Board 3",
      "Board 4",
      "Board 7",
      expect.any(String),
    ]),
  );

  // Expanded, the plan shows every step in the server's order, still one
  // top-level row of the cap.
  await view.click('[aria-label="Expand Plan"]');
  expect(view.rows().slice(0, 4)).toEqual([
    "Plan",
    "  Step 1",
    "  Step 2",
    "Board 1",
  ]);

  await view.click("[data-show-more]");
  expect(view.rows()).toHaveLength(11);
  await view.dispose();
});

it("opens to the open board's parent, rolls a collapsed parent's changes up, and flattens a search", async () => {
  const project = {
    project: { id: "tree", name: "acme/tree" },
    boards: [
      board({
        reviewId: "stack",
        title: "Stack",
        children: ["lower", "upper"],
      }),
      board({ reviewId: "lower", title: "Lower links", parentId: "stack" }),
      board({
        reviewId: "upper",
        title: "Upper",
        parentId: "stack",
        changed: true,
      }),
      board({ reviewId: "links", title: "Dangling links", createdAt: day(1) }),
    ],
  };

  const view = await mount(props({ reviewId: "lower", project }));

  await vi.waitFor(() =>
    expect(view.rows()).toEqual([
      "Stack",
      "  Lower links",
      "  Upper •",
      "Dangling links",
    ]),
  );

  // Collapsed while its child is open, the parent carries the child's dot.
  await view.click('[aria-label="Collapse Stack"]');
  expect(view.rows()).toEqual(["Stack •", "Dangling links"]);

  // The reader's collapse holds for this project after a remount.
  await view.dispose();
  const again = await mount(props({ reviewId: "links", project }));

  await vi.waitFor(() => expect(again.rows()).toHaveLength(2));

  const search =
    document.querySelector<HTMLInputElement>("input[type=search]")!;

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "links");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(again.rows()).toEqual([
    expect.stringMatching(/Stack.*Lower links/),
    "Dangling links",
  ]);
  await again.dispose();
});
