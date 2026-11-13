// An agent's look at a frame it wrote: the block shows the stop asked for,
// at rest and in view, and reports where its figure is for Desktop to
// capture. Here the harness captures that figure instead, so a reference
// animation renders to a real PNG.

import {
  loadFixture,
  mountWhiteboard,
  settled,
} from "@canvas/whiteboard-fixture";
import { type JsonObject, isJsonObject, parseJsonText } from "@dev.fast/json";
import type { ReviewRenderedFrame } from "@dev.fast/review-protocol";
import {
  type Block,
  documentSchema,
  selectionKey,
} from "@dev.fast/whiteboard-document";
import type { ReviewProgress } from "@review/review-api/review-progress";
import type { Snapshot } from "@review/review-api/store";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { renderStage } from "./stage-renderer";

import "@canvas/styles.css";

const files = import.meta.glob<string>(
  "../../../instructions/animations/retry-backoff/*",
  { query: "?raw", import: "default", eager: true },
);

const ANCHOR = "head/order.ts#L1";

const REVIEW_ID = "render-test";

/** The retry-backoff reference as a block, its code anchors pointed at this
 * board's one range, with the frames it declares. It has two scenarios;
 * "a3fail" sits only in the second. */
function retryBackoff() {
  const folder = Object.fromEntries(
    Object.entries(files).map(([file, text]) => [file.split("/").at(-1), text]),
  );

  const block = parseJsonText(folder["block.json"]!) as JsonObject;

  const code = Object.fromEntries(
    Object.entries(block.code as JsonObject).map(([key, entry]) => [
      key,
      isJsonObject(entry) ? { ...entry, source: ANCHOR } : ANCHOR,
    ]),
  );

  const [parsed] = documentSchema.parse([
    {
      id: "retry",
      type: "animation",
      ...block,
      code,
      html: folder["animation.html"]!,
      frames: parseJsonText(folder["frames.json"]!),
      scenarios: parseJsonText(folder["scenarios.json"]!),
      pins: { repositoryId: "repo", base: "base", head: "head" },
    },
  ]);

  if (parsed?.type !== "animation") throw new Error("not an animation");

  return parsed;
}

// The slot rides the timeline from 0 to 200px between the markers.
const clip: Block = documentSchema.parse([
  {
    id: "trip",
    type: "clip",
    title: "Trip",
    height: 160,
    markers: [
      { key: "start", title: "Start" },
      { key: "end", title: "End" },
    ],
    html: `<div class="wb-node" id="packet" style="width: 120px">packet</div><script>whiteboard.clip().marker("start").add("#packet", { translateX: [0, 200], duration: 600 }).marker("end");</script>`,
    pins: { repositoryId: "repo", base: "base", head: "head" },
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

async function mount(blocks: Block[]) {
  const snapshot: Snapshot = {
    reviewId: REVIEW_ID,
    version: 0,
    title: "Render",
    pins: { repositoryId: "repo", base: "base", head: "head" },
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
    document: blocks,
    createdAt: "2026-10-31T00:00:00.000Z",
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

  expect(await settled(() => container.querySelector("iframe"))).toBeTruthy();

  return container;
}

const text = (container: HTMLElement) => container.textContent ?? "";

// Playwright captures the figure the way Desktop captures its rectangle. An
// unsaved screenshot comes back as its base64.
const capture = (figure: Element) =>
  page.elementLocator(figure).screenshot({ save: false });

/** What a render came to: the frame it showed, or why it did not. */
interface RenderOutcome {
  value?: ReviewRenderedFrame;
  failure?: Error;
}

/** Renders while flushing React, as the canvas's effects commit only inside
 * act in this environment. */
async function render(blockId: string, frame: string) {
  const outcome: RenderOutcome = {};

  const pending = renderStage(REVIEW_ID, blockId, frame).then(
    (value) => {
      outcome.value = value;
    },
    (failure: Error) => {
      outcome.failure = failure;
    },
  );

  await settled(() => "value" in outcome || "failure" in outcome, 40_000);
  await pending;

  if (outcome.failure) throw outcome.failure;

  return outcome.value!;
}

describe("renderStage", () => {
  it("shows a reference animation's frame, switching scenario for it, and the figure captures as a PNG", async () => {
    const reference = retryBackoff();
    const container = await mount([reference]);
    const figure = container.querySelector(".animation-block")!;

    const rendered = await render("retry", "a3fail");

    const title = reference.frames.find(
      (frame) => frame.key === "a3fail",
    )!.title;

    expect(rendered).toMatchObject({
      frame: { key: "a3fail", title, position: 4, count: 8 },
      scenario: "gives-up",
      clipped: false,
      error: null,
    });
    expect(text(container)).toContain("5 / 8");
    expect(text(container)).toContain(rendered.frame.title);

    const box = figure.getBoundingClientRect();
    expect(rendered.rect).toEqual({
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
    });
    expect(rendered.rect.width).toBeGreaterThan(400);
    expect(rendered.rect.height).toBeGreaterThan(120);

    const png = await capture(figure);
    // A PNG, and not a blank one: its signature, then enough bytes to draw.
    expect(png.startsWith("iVBORw0KGgo")).toBe(true);
    expect(png.length).toBeGreaterThan(8_000);

    // Back within the scenario showing, a frame already shown returns at once.
    const again = await render("retry", "a1");
    expect(again.frame).toMatchObject({ key: "a1", position: 0, count: 8 });
    expect(text(container)).toContain("1 / 8");
  });

  it("lands a clip on a marker at rest", async () => {
    const container = await mount([clip]);

    const rendered = await render("trip", "end");

    expect(rendered).toMatchObject({
      frame: { key: "end", title: "End", position: 1, count: 2 },
      clipped: false,
      error: null,
    });
    expect(text(container)).toContain("2 / 2");
    // At rest at its end: the control offers Replay, not Pause.
    expect(container.querySelector("button[aria-label='Pause']")).toBeNull();
    expect(container.querySelector("button[aria-label='Replay']")).toBeTruthy();
  });

  it("waits for a block that is still drawing in before it reports", async () => {
    const container = await mount([clip]);

    // The board is still drawing the block in, as it does for one an agent
    // just wrote.
    const block = container.querySelector<HTMLElement>(
      "[data-review-node-id='trip']",
    )!;

    block.dataset.motion = "landing";

    let done = false;

    const pending = render("trip", "end").then((rendered) => {
      done = true;

      return rendered;
    });

    await act(() => new Promise((resolve) => setTimeout(resolve, 1500)));
    expect(done).toBe(false);

    delete block.dataset.motion;
    expect((await pending).frame.key).toBe("end");
  });

  it("names a stop the block does not have, and a block the board does not", async () => {
    await mount([clip]);

    await expect(render("trip", "middle")).rejects.toThrow(
      "middle is not a marker of the clip.",
    );
    await expect(render("other", "start")).rejects.toThrow(
      "other is not an animation, clip or diagram on the board showing.",
    );
  });
});
