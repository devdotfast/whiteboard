import type {
  ReviewApiSummary,
  ReviewProjectThread,
  ReviewSidebarSectionProps,
  ReviewThreadsFilter,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { mountReviewSidebarSection } from "./desktop-entry";
import type { ReviewTocEntry } from "./review-document-headings";
import { ContentsList } from "./sidebar-sections";

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
  section: "family",
  connection: { serverUrl: "http://review.test", token: "t" },
  reviewId: "pr",
  onOpenBoard: () => {},
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

it("shows the open board's family with its place, the boards opened last, and a flat search", async () => {
  const project = {
    project: { id: "caps", name: "acme/caps" },
    boards: [
      board({
        reviewId: "plan",
        title: "Plan",
        children: ["s1", "s2", "s3"],
        viewedAt: day(3),
      }),
      board({ reviewId: "s1", title: "Step 1", parentId: "plan" }),
      board({ reviewId: "s2", title: "Step 2", parentId: "plan" }),
      board({
        reviewId: "s3",
        title: "Step 3",
        parentId: "plan",
        changed: true,
      }),
      ...Array.from({ length: 6 }, (_, index) =>
        board({
          reviewId: `b${index + 1}`,
          title: `Board ${index + 1}`,
          viewedAt: day(20 - index),
        }),
      ),
      board({ reviewId: "never", title: "Never opened" }),
    ],
  };

  const view = await mount(props({ reviewId: "s2", project }));

  // This board: the parent, its children in order, and where this one sits.
  await vi.waitFor(() =>
    expect(view.rows().slice(0, 4)).toEqual([
      "Plan",
      "  Step 1",
      "  Step 2",
      "  Step 3 •",
    ]),
  );
  expect(document.body.textContent).toContain("This board2 of 3");

  // Recent, which Desktop puts under Contents: the five opened last, newest
  // first, then the rest on request.
  const recent = await mount(
    props({ section: "recent", reviewId: "s2", project }),
  );

  expect(recent.rows()).toEqual([
    "Board 1",
    "Board 2",
    "Board 3",
    "Board 4",
    "Board 5",
    "Show 2 more",
  ]);
  await recent.click("[data-show-more]");
  expect(recent.rows().slice(5, 7)).toEqual(["Board 6", "Plan"]);
  await recent.dispose();

  // A search lists every match flat, a child after its parent's name.
  const finder = await mount(
    props({ section: "whiteboards", reviewId: "s2", project }),
  );

  const search =
    document.querySelector<HTMLInputElement>("input[type=search]")!;

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "step");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(finder.rows()).toHaveLength(3);
  expect(finder.rows()[0]).toMatch(/Plan.*Step/);
  await finder.dispose();
  await view.dispose();
});

it("shows a top-level board with its children, and starts a new whiteboard from its header", async () => {
  const onNewWhiteboard = vi.fn<() => void>();

  const project = {
    project: { id: "top", name: "acme/top" },
    boards: [
      board({ reviewId: "plan", title: "Plan", children: ["s1"] }),
      board({ reviewId: "s1", title: "Step 1", parentId: "plan" }),
    ],
  };

  const view = await mount(
    props({ reviewId: "plan", project, onNewWhiteboard }),
  );

  await vi.waitFor(() => expect(view.rows()).toEqual(["Plan", "  Step 1"]));
  expect(document.body.textContent).toContain("This board1 step");
  await view.click('[aria-label="New whiteboard"]');
  expect(onNewWhiteboard).toHaveBeenCalledOnce();
  await view.dispose();
});

it("picks one of the board's commits for the diff, in ancestry order, and steps through them", async () => {
  const onPickCommit = vi.fn<(commit: string | null) => void>();

  // Newest first, as git lists them; a rebase left the dates out of order.
  const commit = (sha: string, subject: string, authored: number) => ({
    commit: sha.repeat(40),
    subject,
    author: "ketan",
    authoredAt: day(authored),
    additions: 2,
    deletions: 1,
  });

  const list = [
    commit("c", "Third", 5),
    commit("b", "Second", 9),
    commit("a", "First", 7),
  ];

  const picker = (selected?: string) =>
    props({
      section: "commitPicker",
      commits: { list, ...(selected && { selected: selected.repeat(40) }) },
      onPickCommit,
    });

  const view = await mount(picker());

  const menuRows = () =>
    [...document.querySelectorAll("[role=menuitemradio]")].map(
      (row) => row.textContent,
    );

  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Commits3"),
  );
  expect(document.body.textContent).not.toContain("All commits");

  // Oldest first by ancestry, whatever the dates say.
  await view.click('[aria-haspopup="menu"]');
  expect(menuRows()).toEqual([
    expect.stringContaining("All commits3 commits"),
    expect.stringContaining("First"),
    expect.stringContaining("Second"),
    expect.stringContaining("Third"),
  ]);
  expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");

  // Arrows move through the menu.
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  expect(document.activeElement?.textContent).toContain("First");

  // A pointer down anywhere outside closes it, and so does the window
  // losing focus to another frame.
  const menuOpen = () => document.querySelector('[role="menu"]') !== null;

  await act(async () => {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  expect(menuOpen()).toBe(false);
  await view.click('[aria-haspopup="menu"]');
  expect(menuOpen()).toBe(true);
  await act(async () => {
    window.dispatchEvent(new Event("blur"));
  });
  expect(menuOpen()).toBe(false);
  await view.click('[aria-haspopup="menu"]');

  // Flipped, newest first.
  await view.click('[aria-label="Oldest first"]');
  expect(menuRows().slice(1)).toEqual([
    expect.stringContaining("Third"),
    expect.stringContaining("Second"),
    expect.stringContaining("First"),
  ]);
  await view.click("[role=menuitemradio]:nth-child(1)");
  expect(onPickCommit).toHaveBeenLastCalledWith(null);

  // One picked: its id, and steps to the older and the newer.
  await act(async () => view.update(picker("b")));
  expect(document.body.textContent).toContain("Commitbbbbbbb");
  await view.click('[aria-label="Older commit"]');
  expect(onPickCommit).toHaveBeenLastCalledWith("a".repeat(40));
  await view.click('[aria-label="Newer commit"]');
  expect(onPickCommit).toHaveBeenLastCalledWith("c".repeat(40));
  await view.click('[aria-label="Show all commits"]');
  expect(onPickCommit).toHaveBeenLastCalledWith(null);

  // At the oldest, there is no older one.
  await act(async () => view.update(picker("a")));
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Older commit"]')
      ?.disabled,
  ).toBe(true);

  // One commit: the same pill and menu, and nothing to step to.
  await act(async () =>
    view.update(
      props({
        section: "commitPicker",
        commits: { list: [list[2]!], selected: "a".repeat(40) },
        onPickCommit,
      }),
    ),
  );
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Older commit"]')
      ?.disabled,
  ).toBe(true);
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Newer commit"]')
      ?.disabled,
  ).toBe(true);
  await act(async () =>
    view.update(
      props({
        section: "commitPicker",
        commits: { list: [list[2]!] },
        onPickCommit,
      }),
    ),
  );
  expect(document.body.textContent).toContain("Commits1");
  await view.click('[aria-label="All 1 commit. Choose commits"]');
  expect(menuRows()).toEqual([
    expect.stringContaining("All commits1 commit"),
    expect.stringContaining("First"),
  ]);
  // Picking the one commit works as it does among many.
  await view.click('[role=menuitemradio][aria-checked="false"]');
  expect(onPickCommit).toHaveBeenLastCalledWith("a".repeat(40));

  // Its own changes stand where the board's remaining count goes.
  await act(async () => view.update({ ...picker("a"), section: "remaining" }));
  expect(document.body.textContent).toContain("This commit+2−1");
  await view.dispose();
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
    { ...thread("other-project", "notes", [], "notes"), place: "notes-app" },
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
  // Each says where it lives.
  expect(rows().at(-1)).toContain("Question other-project");
  expect(rows().at(-1)).toContain("notes-app");

  await act(async () =>
    container.querySelector<HTMLButtonElement>("li button")!.click(),
  );
  expect(onOpenThread).toHaveBeenCalledWith("pinned");
  await act(async () => handle!.dispose());
});

const mountContents = async (entries: ReviewTocEntry[]) => {
  const container = document.createElement("div");

  document.body.append(container);
  await act(async () => {
    createRoot(container).render(
      <ContentsList entries={entries} onOpen={() => {}} />,
    );
  });

  return container;
};

it("indents each section level of Contents one step under its parent", async () => {
  const container = await mountContents([
    { id: "a", text: "Top", level: "h2", depth: 1 },
    { id: "b", text: "Sub", level: "h3", depth: 2 },
    { id: "c", text: "Subsub", level: "h3", depth: 3 },
    { id: "d", text: "Next", level: "h2", depth: 1 },
  ]);

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
  const container = await mountContents([
    { id: "a", text: "Section", level: "h2" },
    { id: "b", text: "Sub", level: "h3" },
  ]);

  const rows = [...container.querySelectorAll("button")];

  const left = (index: number) =>
    rows[index]!.querySelector("span:last-child")!.getBoundingClientRect().left;

  expect(rows.map((row) => row.textContent)).toEqual(["1Section", "Sub"]);
  expect(left(1)).toBe(left(0));
});

it("caps a long family: the parent stays, the open board starts centred, and fades mark more above or below", async () => {
  const steps = Array.from({ length: 17 }, (_, index) => `s${index + 1}`);

  const project = {
    project: { id: "long", name: "acme/long" },
    boards: [
      board({ reviewId: "plan", title: "Plan", children: steps }),
      ...steps.map((id, index) =>
        board({ reviewId: id, title: `Step ${index + 1}`, parentId: "plan" }),
      ),
    ],
  };

  const view = await mount(props({ reviewId: "s8", project }));

  const scroller = () =>
    document.querySelector<HTMLElement>("[data-family-scroller]")!;

  const fades = () =>
    [...document.querySelectorAll<HTMLElement>("[data-fade]")].map(
      (fade) => fade.dataset.fade,
    );

  const scrollTo = (top: number) =>
    act(async () => {
      scroller().scrollTop = top;
      scroller().dispatchEvent(new Event("scroll"));
    });

  /** How far the open board's row sits from the area's middle, in rows. */
  const offCentre = () => {
    const area = scroller().getBoundingClientRect();

    const row = scroller()
      .querySelector("[aria-current]")!
      .getBoundingClientRect();

    return (
      Math.abs(row.top + row.height / 2 - (area.top + area.height / 2)) /
      row.height
    );
  };

  await vi.waitFor(() => expect(scroller()).toBeTruthy());

  const parent = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Plan",
  )!;

  const parentTop = parent.getBoundingClientRect().top;

  // Eight and a half rows show, the open board in the middle of them.
  expect(scroller().contains(parent)).toBe(false);
  expect(scroller().clientHeight).toBeLessThan(scroller().scrollHeight);
  expect(offCentre()).toBeLessThan(1);
  expect(fades()).toEqual(["top", "bottom"]);

  await scrollTo(0);
  expect(fades()).toEqual(["bottom"]);
  expect(parent.getBoundingClientRect().top).toBe(parentTop);

  await scrollTo(scroller().scrollHeight);
  expect(fades()).toEqual(["top"]);

  // A re-render leaves the reader's scroll alone; a new open board is
  // brought to the middle, or as near as the end allows.
  await view.update(props({ reviewId: "s8", project }));
  expect(fades()).toEqual(["top"]);
  await view.update(props({ reviewId: "s17", project }));
  expect(fades()).toEqual(["top"]);
  await view.update(props({ reviewId: "s9", project }));
  expect(offCentre()).toBeLessThan(1);
  await view.dispose();
});

it("lists a short family whole, with no cap and no fades", async () => {
  const project = {
    project: { id: "short", name: "acme/short" },
    boards: [
      board({ reviewId: "plan", title: "Plan", children: ["s1", "s2"] }),
      board({ reviewId: "s1", title: "Step 1", parentId: "plan" }),
      board({ reviewId: "s2", title: "Step 2", parentId: "plan" }),
    ],
  };

  const view = await mount(props({ reviewId: "s2", project }));

  const scroller = document.querySelector<HTMLElement>(
    "[data-family-scroller]",
  )!;

  expect(scroller.clientHeight).toBe(scroller.scrollHeight);
  expect(document.querySelector("[data-fade]")).toBeNull();
  await view.dispose();
});

it("ends every Recent row in its checkout's folder, as Home names it, else its project", async () => {
  const recent = await mount(
    props({
      section: "recent",
      reviewId: "open",
      recent: [
        board({
          reviewId: "here",
          title: "Here",
          viewedAt: day(3),
          repositoryPath: "/work/review-skills",
          project: { id: "skills", name: "acme/skills" },
        }),
        board({
          reviewId: "plan",
          title: "Plan",
          viewedAt: day(2),
          project: { id: "caps", name: "acme/caps" },
        }),
      ],
    }),
  );

  const folders = [
    ...document.querySelectorAll<HTMLElement>("li [title]:has(svg)"),
  ].map((folder) => folder.textContent);

  expect(folders).toEqual(["review-skills", "acme/caps"]);
  await recent.dispose();
});
