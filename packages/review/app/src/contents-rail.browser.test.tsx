import { act, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { ContentsRail } from "./contents-rail";
import type { ReviewTocEntry } from "./review-document-headings";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
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
      <header>
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
  // At rest the rail sits at the board's top right, 16px in.
  const rail = board.rail.getBoundingClientRect();
  const region = board.region.getBoundingClientRect();

  expect(region.right - rail.right).toBe(16);
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
