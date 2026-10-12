import type {
  ReviewApiSummary,
  ReviewProjectThread,
  ReviewSidebarSectionProps,
  ReviewThreadsFilter,
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

it("lists the board's threads, the project's, or every project's", async () => {
  const ref = (reviewId: string, title: string) => ({
    reviewId,
    title,
    icon: "board" as const,
  });

  const thread = (
    id: string,
    anchor: string,
    edited: string[],
    projectId = "app",
  ): ReviewProjectThread => ({
    id,
    projectId,
    agent: "claude",
    agentName: "Claude Code",
    opening: `Question ${id}`,
    updatedAt: "2026-10-06T12:00:00Z",
    anchor: { board: ref(anchor, `Board ${anchor}`), block: "b1" },
    pinned: true,
    edited: edited.map((board) => ref(board, `Board ${board}`)),
  });

  const list = [
    thread("pinned", "pr", []),
    { ...thread("edits-pr", "plan", ["pr"]), status: "waiting" as const },
    thread("elsewhere", "plan", []),
    thread("other-project", "notes", [], "notes"),
  ];

  const onOpenThread =
    vi.fn<NonNullable<ReviewSidebarSectionProps["onOpenThread"]>>();

  const container = document.createElement("div");
  document.body.append(container);
  let handle: ReturnType<typeof mountReviewSidebarSection> | undefined;

  const mount = (filter: ReviewThreadsFilter) =>
    props({
      section: "threads",
      threads: { list, project: "app", filter, open: ["edits-pr"] },
      onOpenThread,
    });

  await act(async () => {
    handle = mountReviewSidebarSection(container, mount("board"));
  });

  const rows = () =>
    [...container.querySelectorAll("li button")].map((row) => row.textContent);

  // Started here, or started on the plan and edited this board.
  await vi.waitFor(() => expect(rows()).toHaveLength(2));
  expect(container.querySelector("[aria-current=true]")?.textContent).toContain(
    "Question edits-pr",
  );

  await act(async () => handle!.update(mount("project")));
  expect(rows()).toHaveLength(3);

  await act(async () => handle!.update(mount("all")));
  expect(rows()).toHaveLength(4);
  expect(rows().at(-1)).toContain("Question other-project");

  await act(async () =>
    container.querySelector<HTMLButtonElement>("li button")!.click(),
  );
  expect(onOpenThread).toHaveBeenCalledWith("pinned");
  await act(async () => handle!.dispose());
});

it("indents each section level of Contents one step under its parent", async () => {
  const container = document.createElement("div");

  document.body.append(container);
  await act(async () => {
    mountReviewSidebarSection(
      container,
      props({
        section: "contents",
        contents: [
          { id: "a", text: "Top", level: "h2", depth: 1 },
          { id: "b", text: "Sub", level: "h3", depth: 2 },
          { id: "c", text: "Subsub", level: "h3", depth: 3 },
          { id: "d", text: "Next", level: "h2", depth: 1 },
        ],
      }),
    );
  });

  const rows = [...container.querySelectorAll("button")];

  const left = (index: number) =>
    rows[index]!.querySelector("span:last-child")!.getBoundingClientRect().left;

  expect(rows.map((row) => row.textContent)).toEqual([
    "1Top",
    "Sub",
    "Subsub",
    "2Next",
  ]);
  // A subsection's text lines up with its section's, past the number;
  // each level below steps in once more.
  expect(left(1)).toBe(left(0));
  expect(left(2) - left(1)).toBe(16);
  expect(left(3)).toBe(left(0));
});

it("reads entries without a depth as before: an h3 under the h2 above it", async () => {
  const container = document.createElement("div");

  document.body.append(container);
  await act(async () => {
    mountReviewSidebarSection(
      container,
      props({
        section: "contents",
        contents: [
          { id: "a", text: "Section", level: "h2" },
          { id: "b", text: "Sub", level: "h3" },
        ],
      }),
    );
  });

  const rows = [...container.querySelectorAll("button")];

  const left = (index: number) =>
    rows[index]!.querySelector("span:last-child")!.getBoundingClientRect().left;

  expect(rows.map((row) => row.textContent)).toEqual(["1Section", "Sub"]);
  expect(left(1)).toBe(left(0));
});
