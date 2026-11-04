// A clip runs in the same sandboxed stage as an animation, as one timeline
// the reader plays and jumps around by markers. The stage is opaque to the
// test, so these read what the host draws: the meta, the Markers strip, the
// play button, and the overlay of a block slot the clip's script moves.

import {
  loadFixture,
  mountWhiteboard,
  settled,
} from "@canvas/whiteboard-fixture";
import {
  type Block,
  documentSchema,
  selectionKey,
} from "@dev.fast/whiteboard-document";
import type { ReviewProgress } from "@review/review-api/review-progress";
import type { Snapshot } from "@review/review-api/store";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";

import "@canvas/styles.css";

const note: Block = {
  id: "note",
  type: "markdown",
  markdown: "Moving note.\n",
};

const markers = [
  { key: "start", title: "Start", caption: "It sets off." },
  { key: "middle", title: "Middle", code: ["status"] },
  { key: "end", title: "End", caption: "It arrives.", code: ["status"] },
];

// The slot rides the timeline: x 0 at the start, 200 at the middle and 300
// at the end. The middle's handler drops it 40px, so a jump shows it ran.
const SCRIPT = `
  const slot = document.querySelector("#slot");
  const build = (clip, far) =>
    clip
      .marker("start")
      .add(slot, { translateX: [0, 200], duration: 600, ease: "linear" })
      .marker("middle")
      .add(slot, { translateX: far, duration: 600, ease: "linear" })
      .marker("end");
  whiteboard.on("middle", () => { slot.style.marginTop = "40px"; });
  whiteboard.on("start", () => { slot.style.marginTop = "0px"; });
`;

const clipBlock = (
  script = `${SCRIPT} build(whiteboard.clip(), 300);`,
  extra: { scenarios?: { key: string; label: string }[] } = {},
): Block =>
  documentSchema.parse([
    {
      id: "clip-1",
      type: "clip",
      title: "Trip",
      height: 200,
      markers,
      code: { status: "head/order.ts#L1" },
      html: `<div id="slot" data-wb-block="note" style="width: 160px"></div><script>${script}</script>`,
      pins: { repositoryId: "repo", base: "base", head: "head" },
      ...extra,
    },
  ])[0]!;

const progress: ReviewProgress = {
  files: [],
  lenses: [],
  resolvedSelections: {
    [selectionKey({
      file: "order.ts",
      start: { side: "head", line: 1 },
      end: { side: "head", line: 1 },
    })]: [{ file: "order.ts", side: "head", fromLine: 1, toLine: 1 }],
  },
};

let canvas: ReturnType<typeof mountWhiteboard> | undefined;

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
  document.body.replaceChildren();
});

async function mount(block: Block) {
  const snapshot: Snapshot = {
    reviewId: "clip-review",
    version: 0,
    title: "Clips",
    pins: { repositoryId: "repo", base: "base", head: "head" },
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
    document: [block, note],
    createdAt: "2026-11-01T00:00:00.000Z",
  };

  const container = document.createElement("div");
  container.style.cssText = "width: 860px; margin: 0 auto;";
  document.body.append(container);

  await act(async () => {
    canvas = mountWhiteboard(
      container,
      loadFixture({
        snapshot,
        progress,
        commits: [],
        images: {},
        traces: {},
        maps: {},
      }),
    );
  });

  return container;
}

const figure = () => document.querySelector<HTMLElement>(".animation-block")!;

const meta = () =>
  document.querySelector(".animation-block figcaption em")?.textContent;

const strip = () => [
  ...document.querySelectorAll<HTMLButtonElement>(
    ".animation-block [role='group'][aria-label='Markers'] button",
  ),
];

const current = () =>
  strip()
    .find((button) => button.getAttribute("aria-current") === "step")
    ?.textContent?.replace(/^\d+/, "");

const alertText = () =>
  document.querySelector(".animation-block [role='alert']")?.textContent ??
  null;

const playButton = () =>
  document.querySelector<HTMLButtonElement>(
    ".animation-block button[aria-label='Play'], .animation-block button[aria-label='Pause'], .animation-block button[aria-label='Replay']",
  )!;

const overlay = () =>
  document.querySelector<HTMLElement>(
    ".animation-block [data-animation-slot='block']",
  );

/** Where the stage put the moving slot, in stage pixels. */
const position = () => {
  const matrix = new DOMMatrix(overlay()?.style.transform ?? "none");

  return { x: Math.round(matrix.m41), y: Math.round(matrix.m42) };
};

const click = (button: HTMLButtonElement) => act(async () => button.click());

const wait = (ms: number) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));

/** Mounted, with the slot laid out at the clip's start. */
async function booted(block = clipBlock()) {
  const container = await mount(block);

  expect(await settled(() => overlay()?.style.visibility === "visible")).toBe(
    true,
  );
  expect(await settled(() => meta() === `1 / ${markers.length}`)).toBe(true);

  return container;
}

describe("clip", () => {
  it("boots and lists its markers under the stage", async () => {
    await booted();

    expect(strip().map((button) => button.textContent)).toEqual([
      "1Start",
      "2Middle",
      "3End",
    ]);
    expect(current()).toBe("Start");
    expect(playButton().getAttribute("aria-label")).toBe("Play");
    expect(figure().textContent).toContain("It sets off.");
    expect(
      document.querySelector(".animation-block figcaption")?.textContent,
    ).toContain("CLIP");
    expect(alertText()).toBeNull();
  });

  it("plays to its end, the active marker following the playhead", async () => {
    await booted();
    const start = position();

    await click(playButton());
    expect(playButton().getAttribute("aria-label")).toBe("Pause");
    expect(await settled(() => current() === "Middle", 4000)).toBe(true);
    expect(meta()).toBe("2 / 3");

    expect(
      await settled(
        () => playButton().getAttribute("aria-label") === "Replay",
        4000,
      ),
    ).toBe(true);
    expect(current()).toBe("End");
    expect(meta()).toBe("3 / 3");
    expect(figure().textContent).toContain("It arrives.");
    expect(await settled(() => position().x === start.x + 300)).toBe(true);
    expect(alertText()).toBeNull();

    // Replay starts over from the start.
    await click(playButton());
    expect(await settled(() => current() === "Start")).toBe(true);
  });

  it("holds the playhead while paused", async () => {
    await booted();
    const start = position().x;

    await click(playButton());
    expect(await settled(() => position().x > start + 20, 4000)).toBe(true);
    await click(playButton());
    expect(playButton().getAttribute("aria-label")).toBe("Play");
    await wait(150);
    const held = position().x;

    await wait(500);
    expect(position().x).toBe(held);
    expect(held).toBeLessThan(start + 300);
  });

  it("jumps to a marker from the strip and runs its handler", async () => {
    await booted();
    const start = position();

    await click(strip()[1]!);
    expect(await settled(() => meta() === "2 / 3")).toBe(true);
    // Landed at the middle's time, with its handler's drop.
    expect(
      await settled(
        () => position().x === start.x + 200 && position().y === start.y + 40,
      ),
    ).toBe(true);
    expect(playButton().getAttribute("aria-label")).toBe("Play");

    // Arrow keys on the focused figure step between markers.
    figure().focus();
    await act(async () =>
      figure().dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(await settled(() => meta() === "3 / 3")).toBe(true);
    expect(await settled(() => position().x === start.x + 300)).toBe(true);

    await click(strip()[0]!);
    expect(
      await settled(() => position().x === start.x && position().y === start.y),
    ).toBe(true);

    // Space on the figure plays.
    await act(async () =>
      figure().dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      ),
    );
    expect(playButton().getAttribute("aria-label")).toBe("Pause");
  });

  it("builds a scenario's own timeline when the reader picks it", async () => {
    await booted(
      clipBlock(
        `${SCRIPT} build(whiteboard.clip("near"), 240); build(whiteboard.clip("far"), 400);`,
        {
          scenarios: [
            { key: "near", label: "Near" },
            { key: "far", label: "Far" },
          ],
        },
      ),
    );
    const start = position().x;

    const end = async () => {
      await click(strip()[2]!);
      expect(await settled(() => meta() === "3 / 3")).toBe(true);
      await wait(150);

      return position().x - start;
    };

    expect(await end()).toBe(240);

    await click(
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          "[role='group'][aria-label='Scenario'] button",
        ),
      ].find((button) => button.textContent === "Far")!,
    );
    // Back at the start of the new timeline.
    expect(await settled(() => meta() === "1 / 3")).toBe(true);
    expect(await settled(() => position().x === start)).toBe(true);
    expect(await end()).toBe(400);
    expect(alertText()).toBeNull();
  });

  it("reports a declared marker its script never places", async () => {
    await mount(
      clipBlock(
        `whiteboard.clip().marker("start").add("#slot", { translateX: 100 }).marker("middle");`,
      ),
    );

    expect(
      await settled(() => alertText()?.includes('Marker "end" is not placed')),
    ).toBe(true);
  });

  it("refuses an animation's frame API in a clip", async () => {
    await mount(
      clipBlock(
        `${SCRIPT} build(whiteboard.clip(), 300); whiteboard.goto("start");`,
      ),
    );

    expect(
      await settled(() => alertText()?.includes("A clip has no frames")),
    ).toBe(true);
  });

  it("steps marker to marker without motion under reduced motion", async () => {
    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    try {
      await booted();
      const start = position().x;
      const seen = new Set<number>();

      await click(playButton());

      // Every sample is a marker's place: the slot never moves between them.
      const sample = setInterval(() => seen.add(position().x - start), 20);

      try {
        expect(await settled(() => meta() === "2 / 3", 5000)).toBe(true);
        expect(await settled(() => meta() === "3 / 3", 5000)).toBe(true);
        expect(
          await settled(
            () => playButton().getAttribute("aria-label") === "Replay",
            5000,
          ),
        ).toBe(true);
      } finally {
        clearInterval(sample);
      }

      expect([...seen].sort((a, b) => a - b)).toEqual([0, 200, 300]);
    } finally {
      await cdp().send("Emulation.setEmulatedMedia", { features: [] });
    }
  }, 20_000);

  it("tours its markers, the panel following playback", async () => {
    await booted();

    const tourOverlay = () => document.querySelector(".diagram-tour-overlay");
    const pill = () => document.querySelector(".tour-pill-count")?.textContent;

    const tour = await settled(() =>
      document.querySelector<HTMLButtonElement>(".diagram-tour-button"),
    );

    await click(tour!);
    expect(await settled(tourOverlay)).toBeTruthy();
    // Fullscreen is a new stage: it has laid the slot out again.
    expect(await settled(() => overlay()?.style.visibility === "visible")).toBe(
      true,
    );
    expect(
      await settled(
        () =>
          tourOverlay()!.querySelectorAll("section[data-review-anchor-id]")
            .length === 3,
      ),
    ).toBe(true);
    expect(
      tourOverlay()!.querySelector(
        "[data-review-anchor-id='clip-1:marker:middle']",
      ),
    ).toBeTruthy();

    // The panel's Next seeks to the next marker, paused.
    await click(
      tourOverlay()!.querySelector<HTMLButtonElement>(
        "[data-tour-target='tour-next']",
      )!,
    );
    expect(await settled(() => meta() === "2 / 3")).toBe(true);
    expect(pill()).toBe("2/3");
    expect(playButton().getAttribute("aria-label")).toBe("Play");

    // Playing on, the panel follows the markers the playhead passes.
    await click(playButton());
    expect(await settled(() => pill() === "3/3", 4000)).toBe(true);
    expect(meta()).toBe("3 / 3");
  });
});
