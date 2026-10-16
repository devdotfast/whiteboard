import type { ReviewMenuRequest } from "@dev.fast/review-protocol";
import codeFixture from "@review/fixtures/blocks/code.json";
import flowFixture from "@review/fixtures/blocks/flow_diagram.json";
import { type Block, documentSchema } from "@review/review-api/document";
import type { Snapshot } from "@review/review-api/store";
import { act, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { ContentsRail } from "./contents-rail";
import { mountReviewCanvas } from "./desktop-entry";
import { fixtureReviewBridge, settled } from "./fixture-review-bridge";
import type { ReviewTocEntry } from "./review-document-headings";

let root: Root | null = null;

let canvas: ReturnType<typeof mountReviewCanvas> | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  await act(async () => canvas?.dispose());
  root = null;
  canvas = undefined;
});

/** Sections with subsections under them, each heading followed by enough
 * text to scroll. */
const outline = (sections: number, subsections: number): ReviewTocEntry[] =>
  Array.from({ length: sections }, (_, section) => [
    { id: `s${section}`, text: `Section ${section}`, level: "h2" as const },
    ...Array.from({ length: subsections }, (_, sub) => ({
      id: `s${section}-${sub}`,
      text: `Section ${section}.${sub}`,
      level: "h3" as const,
    })),
  ]).flat();

function Board({ entries }: { entries: ReviewTocEntry[] }) {
  const region = useRef<HTMLElement>(null);
  const article = useRef<HTMLElement>(null);
  const bar = useRef<HTMLElement>(null);

  return (
    <main
      ref={(main) => main?.style.setProperty("--review-page-top", "20px")}
      style={{
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        width: "900px",
        height: "600px",
      }}
    >
      <header ref={bar}>
        <button type="button">Before</button>
      </header>
      <section ref={region} tabIndex={-1} style={{ overflowY: "auto" }}>
        <article ref={article}>
          {entries.map((entry) => {
            const Heading = entry.level;

            return (
              <div key={entry.id}>
                <Heading id={entry.id}>{entry.text}</Heading>
                <p style={{ height: "300px" }}>Text</p>
              </div>
            );
          })}
        </article>
      </section>
      <ContentsRail
        entries={entries}
        articleRef={article}
        scrollRegionRef={region}
        barAnchor={bar}
      />
    </main>
  );
}

const mount = async (entries: ReviewTocEntry[]) => {
  const host = document.createElement("div");

  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Board entries={entries} />));

  const region = host.querySelector("section")!;

  return {
    region,
    rail: host.querySelector<HTMLElement>('[role="button"]')!,
    ticks: () => [...host.querySelectorAll<HTMLElement>("[data-heading]")],
    card: () => document.querySelector<HTMLElement>('[role="menu"]'),
    rows: () => [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ],
    /** How far a heading sits below the top of the board's scroller. */
    below: (id: string) =>
      document.getElementById(id)!.getBoundingClientRect().top -
      region.getBoundingClientRect().top,
  };
};

/** Each tick's drawn length, once its transition settles. */
const lengths = async (ticks: HTMLElement[]) => {
  await new Promise((resolve) => setTimeout(resolve, 200));

  return ticks.map(
    (tick) => tick.firstElementChild!.getBoundingClientRect().width,
  );
};

/** Rests the pointer on `element` until the card has had time to open. */
const hover = (element: HTMLElement) =>
  act(async () => {
    await userEvent.hover(element);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

const scrollTo = async (region: HTMLElement, id: string) => {
  await act(async () => {
    region.scrollTop +=
      document.getElementById(id)!.getBoundingClientRect().top -
      region.getBoundingClientRect().top;
    // The scroll event fires on the next frame.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
};

it("draws a tick per heading, a section's longer than a subsection's, the current one longest", async () => {
  const board = await mount(outline(3, 2));

  expect(board.ticks().map((tick) => tick.dataset.heading)).toEqual([
    "s0",
    "s0-0",
    "s0-1",
    "s1",
    "s1-0",
    "s1-1",
    "s2",
    "s2-0",
    "s2-1",
  ]);

  const [current, sub, , section] = await lengths(board.ticks());

  expect(current).toBeGreaterThan(section!);
  expect(section).toBeGreaterThan(sub!);
  // At rest the ticks sit at the board's top right, 14px in.
  const rail = board.rail.getBoundingClientRect();
  const region = board.region.getBoundingClientRect();

  expect(region.right - rail.right).toBe(14);
  expect(rail.top).toBeGreaterThan(region.top);
});

it("moves the current tick as the board scrolls", async () => {
  const board = await mount(outline(3, 2));

  await scrollTo(board.region, "s1-1");

  const widths = await lengths(board.ticks());
  const longest = widths.indexOf(Math.max(...widths));

  expect(board.ticks()[longest]!.dataset.heading).toBe("s1-1");
});

it("opens the card over the rail on hover, and a click there jumps to the heading", async () => {
  const board = await mount(outline(3, 2));

  await hover(board.rail);
  expect(board.card()).not.toBeNull();

  const card = board.card()!.getBoundingClientRect();
  const rail = board.rail.getBoundingClientRect();

  // In place: over the ticks, its right edge on theirs, growing left.
  expect(card.right).toBe(rail.right);
  expect(card.top).toBe(rail.top - 4);
  expect(card.left).toBeLessThan(rail.left);
  expect(board.rows().map((row) => row.textContent)).toEqual(
    outline(3, 2).map((entry) => entry.text),
  );

  // A subsection is indented under its section.
  const text = (row: HTMLElement) => {
    const range = document.createRange();

    range.selectNodeContents(row);

    return range.getBoundingClientRect().left;
  };

  expect(text(board.rows()[1]!)).toBeGreaterThan(text(board.rows()[0]!));
  expect(board.rows()[0]!.getAttribute("aria-current")).toBe("location");

  await act(async () => userEvent.click(board.rows()[6]!));
  expect(Math.abs(board.below("s2"))).toBeLessThanOrEqual(1);
  await vi.waitFor(() => expect(board.card()).toBeNull());
});

it("jumps to a heading from its tick", async () => {
  const board = await mount(outline(3, 2));

  await act(async () => board.ticks()[3]!.click());
  expect(Math.abs(board.below("s1"))).toBeLessThanOrEqual(1);
});

it("opens from Tab on the current row, ↓↵ jumps, and Esc returns focus to the board", async () => {
  const board = await mount(outline(3, 2));

  await scrollTo(board.region, "s1");
  document.querySelector<HTMLElement>("header button")!.focus();
  await act(async () => userEvent.tab());
  await vi.waitFor(() => expect(board.card()).not.toBeNull());
  expect(document.activeElement?.textContent).toBe("Section 1");

  await act(async () => userEvent.keyboard("{ArrowDown}"));
  expect(document.activeElement?.textContent).toBe("Section 1.0");
  await act(async () => userEvent.keyboard("{Enter}"));
  expect(Math.abs(board.below("s1-0"))).toBeLessThanOrEqual(1);
  expect(board.card()).toBeNull();
  expect(document.activeElement).toBe(board.region);

  document.querySelector<HTMLElement>("header button")!.focus();
  await act(async () => userEvent.tab());
  await vi.waitFor(() => expect(board.card()).not.toBeNull());
  await act(async () => userEvent.keyboard("{Escape}"));
  expect(board.card()).toBeNull();
  expect(document.activeElement).toBe(board.region);
});

it("caps a long outline: the rail and the card scroll, keeping the current heading in view", async () => {
  const board = await mount(outline(12, 3));

  await scrollTo(board.region, "s5-1");

  const column = board.rail.firstElementChild!.getBoundingClientRect();

  expect(column.height).toBe(240);
  // The current tick sits in the middle of the capped column.
  const current = board.ticks().find((tick) => tick.dataset.heading === "s5-1");
  const middle = current!.getBoundingClientRect();

  expect(
    Math.abs(middle.top + middle.height / 2 - (column.top + column.height / 2)),
  ).toBeLessThanOrEqual(8);

  await hover(board.rail);
  expect(board.card()).not.toBeNull();

  const card = board.card()!;

  expect(card.getBoundingClientRect().height).toBe(420);
  expect(card.scrollHeight).toBeGreaterThan(card.clientHeight);

  const row = board.rows().find((each) => each.textContent === "Section 5.1");
  const shown = row!.getBoundingClientRect();
  const box = card.getBoundingClientRect();

  expect(row!.getAttribute("aria-current")).toBe("location");
  expect(shown.top).toBeGreaterThanOrEqual(box.top);
  expect(shown.bottom).toBeLessThanOrEqual(box.bottom);
});

/** A board with a long title, headings, a flow diagram and a code card,
 * mounted as Desktop mounts it, in a canvas `width` wide. */
const mountBoard = async (width: number) => {
  const markdown = (id: string, source: string): Block => ({
    id,
    type: "markdown",
    markdown: source,
  });

  const snapshot: Snapshot = {
    reviewId: "rail-layout",
    version: 0,
    title:
      "Fetch missing blobs in partial clones before diffing, then retry the ones a promisor remote refused",
    pins: { repositoryId: "repo", base: "base", head: "head" },
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
    document: [
      markdown("intro", "## What and why\n\nA blobless clone fails.\n"),
      ...documentSchema.parse(flowFixture),
      markdown("design", "## Design\n\n### The pre-pass\n\nIt fetches.\n"),
      ...documentSchema.parse(codeFixture),
      markdown("testing", "## Testing\n\nA clone with a remote.\n"),
    ],
    createdAt: "2026-10-01T00:00:00.000Z",
  };

  let menu: Omit<ReviewMenuRequest, "anchor" | "onHide"> | undefined;
  const container = document.createElement("div");

  container.style.width = `${width}px`;
  container.style.height = "700px";
  document.body.append(container);
  await act(async () => {
    canvas = mountReviewCanvas(
      container,
      {
        kind: "api",
        reviewId: snapshot.reviewId,
        version: 0,
        // Desktop's sidebar leads, so the page bar holds the ⋯ menu.
        bridge: { ...fixtureReviewBridge({ snapshot }), reportSidebar() {} },
      },
      {
        showMenu: (request) => {
          menu = request;

          return { dispose: () => {} };
        },
      },
    );
  });

  const rail = () =>
    container.querySelector<HTMLElement>(
      '[role="button"][aria-label="Contents"]',
    );

  expect(
    await settled(() => rail()?.querySelectorAll("[data-heading]").length),
  ).toBe(4);
  expect(
    await settled(() => container.querySelector(".react-flow__node")),
  ).not.toBeNull();

  return {
    container,
    rail: rail()!,
    region: container.querySelector<HTMLElement>(".review-view-region")!,
    /** The ⋯ menu's items, once opened. */
    more: async () => {
      await act(async () =>
        container.querySelector<HTMLElement>('[aria-label="More"]')!.click(),
      );

      return menu!;
    },
  };
};

it("keeps the title and wide blocks clear of the rail at a medium width", async () => {
  const board = await mountBoard(900);
  const rail = board.rail.getBoundingClientRect();
  const title = board.container.querySelector("h1")!;

  const blocks = [
    title,
    ...board.container.querySelectorAll<HTMLElement>(
      "article [data-review-node-id] > *",
    ),
  ];

  expect(rail.width).toBeGreaterThan(0);
  // The title wraps rather than running under the ticks.
  expect(title.getBoundingClientRect().height).toBeGreaterThan(60);

  for (const block of blocks)
    expect(block.getBoundingClientRect().right).toBeLessThanOrEqual(rail.left);

  expect((await board.more()).items.map((item) => item.label)).not.toContain(
    "Contents",
  );
});

it("hides the rail on a narrow board, and ⋯ opens its contents instead", async () => {
  const board = await mountBoard(600);

  expect(board.rail.getClientRects()).toHaveLength(0);

  const menu = await board.more();

  expect(menu.items[0]?.label).toBe("Contents");
  await act(async () => menu.onSelect("contents"));

  const card = document.querySelector<HTMLElement>('[role="menu"]')!;
  const bar = board.container.querySelector("main > header")!;

  expect(
    [...card.querySelectorAll('[role="menuitem"]')].map(
      (row) => row.textContent,
    ),
  ).toEqual(["What and why", "Design", "The pre-pass", "Testing"]);
  // Under the page bar, at its right, on the current section.
  expect(card.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    bar.getBoundingClientRect().bottom,
  );
  expect(document.activeElement?.textContent).toBe("What and why");

  await act(async () => userEvent.keyboard("{Escape}"));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(board.region);
});

it("overlays the board's scrollbar right of the ticks, shown only while it scrolls", async () => {
  // Headless Chromium hides native scrollbars, so their width can't be
  // measured here; the overlay's lane and its showing can.
  const board = await mountBoard(900);

  const lane = board.container.querySelector<HTMLElement>(
    'main > [aria-hidden="true"]',
  )!;

  const shown = () => Number(getComputedStyle(lane).opacity) > 0;

  expect(board.region.scrollHeight).toBeGreaterThan(board.region.clientHeight);
  expect(lane.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    board.rail.getBoundingClientRect().right,
  );
  expect(lane.getBoundingClientRect().right).toBe(
    board.region.getBoundingClientRect().right,
  );
  expect(shown()).toBe(false);

  await act(async () => {
    board.region.scrollTop = 200;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  await vi.waitFor(() => expect(shown()).toBe(true));
});
