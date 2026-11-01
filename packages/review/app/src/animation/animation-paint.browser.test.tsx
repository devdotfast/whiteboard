// An animation that arrives from the agent's stream paints its first frame
// in: its stage stays unseen until the draw queue reaches it, the queue holds
// on it while it paints, and the stage says when it is done. The stage is a
// sandboxed frame, so these read what the host draws over its placeholders:
// a block slot is shown only while its placeholder is.

import { ApiDocument } from "@canvas/api-document";
import { AuthoringActivityContext } from "@canvas/authoring-activity-context";
import type { AuthoringCursor } from "@canvas/authoring-cursor";
import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
import { ReviewDebugSettingsProvider } from "@canvas/debug-settings";
import { documentStyles } from "@canvas/document-styles";
import {
  type DrawQueueClock,
  DrawQueueProvider,
} from "@canvas/draw-queue-provider";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import { documentMarker } from "@canvas/markers.stylex";
import { ReviewPanelProvider } from "@canvas/review-panel";
import {
  type ReviewRoots,
  ReviewRootsProvider,
} from "@canvas/review-root-context";
import {
  testApiDocumentData,
  testReviewSession,
} from "@canvas/review-session-test-utils";
import { type Block, documentSchema } from "@dev.fast/whiteboard-document";
import * as stylex from "@stylexjs/stylex";
import { act, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cdp } from "vitest/browser";

const note: Block = { id: "note", type: "markdown", markdown: "Lead note.\n" };

const late: Block = { id: "late", type: "markdown", markdown: "Late note.\n" };

const before: Block = { id: "b1", type: "markdown", markdown: "Before.\n" };

const animationBlock = (html: string): Block =>
  documentSchema.parse([
    {
      id: "anim",
      type: "animation",
      title: "Paint",
      frames: [{ key: "a", title: "First" }],
      html,
    },
  ])[0]!;

const nodes = '<div class="wb-row"><div class="wb-node">A</div></div>';

/** A clock the test moves by hand, as in draw-queue.browser.test.tsx: the
 * cap never ends a paint unless the test advances past it. */
const createManualClock = () => {
  let time = 0;
  let nextId = 0;
  let scheduled: { id: number; due: number; fn: () => void } | null = null;

  const clock: DrawQueueClock = {
    now: () => time,
    setTimeout: (fn, ms) => {
      const id = ++nextId;
      scheduled = { id, due: time + ms, fn };

      return id;
    },
    clearTimeout: (handle) => {
      if (scheduled?.id === handle) scheduled = null;
    },
  };

  return {
    clock,
    advance: async (ms: number) => {
      time += ms;
      const due = scheduled;

      if (due && due.due <= time) {
        scheduled = null;
        await act(async () => due.fn());
      }
    },
  };
};

const working = {
  workingCount: 1,
  expiresAt: null,
  activities: [{ activityId: "a", slot: 0 }],
};

let article: HTMLElement, root: Root;

let manualClock: ReturnType<typeof createManualClock>;

beforeEach(() => {
  article = document.createElement("article");
  article.className = `review-document ${stylex.props(documentStyles.article, documentMarker).className}`;
  article.style.width = "900px";
  const container = document.createElement("div");
  article.append(container);
  document.body.append(article);
  root = createRoot(container);
  manualClock = createManualClock();
});

afterEach(async () => {
  await act(async () => root.unmount());
  article.remove();
});

const render = async (cursor: AuthoringCursor | null, blocks: Block[]) => {
  const roots: ReviewRoots = {
    appRef: createRef<HTMLDivElement>(),
    shellRef: createRef<HTMLElement>(),
    scrollRegionRef: createRef<HTMLElement>(),
    articleRef: { current: article },
  };

  await act(async () =>
    root.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={testReviewSession()}>
          <ReviewDebugSettingsProvider>
            <ReviewPanelProvider>
              <ReviewRootsProvider roots={roots}>
                <AuthoringActivityContext.Provider value={working}>
                  <DrawQueueProvider cursor={cursor} clock={manualClock.clock}>
                    <ApiDocument data={testApiDocumentData(blocks)} />
                  </DrawQueueProvider>
                </AuthoringActivityContext.Provider>
              </ReviewRootsProvider>
            </ReviewPanelProvider>
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );
};

let seq = 0;

const insert = (
  id: string,
  kind: "markdown" | "animation" | "clip",
): AuthoringCursor => ({
  targetId: id,
  blockId: id,
  source: "edit",
  edit: { type: "insert", targetId: id, blockId: id, kind },
  seq: ++seq,
});

const motion = () =>
  article.querySelector<HTMLElement>('[data-review-node-id="anim"]')?.dataset
    .motion;

/** The host's overlay for the block slot showing `text`. */
const slot = (text: string) =>
  [
    ...article.querySelectorAll<HTMLElement>(
      ".animation-block [data-animation-slot='block']",
    ),
  ].find((overlay) => overlay.textContent?.includes(text));

const shown = (text: string) => {
  const overlay = slot(text);

  return (
    overlay?.style.visibility === "visible" && overlay.style.opacity === "1"
  );
};

const waitFor = (check: () => void, timeout = 8000) =>
  vi.waitFor(check, { timeout, interval: 20 });

/** Writes `b1` and, behind it in the queue, the animation, so the stage
 * boots while the animation waits its turn. */
const arriveBehindBlock = async (blocks: Block[]) => {
  await render(insert("b1", "markdown"), [before, note, late]);
  await render(insert("anim", "animation"), [before, ...blocks, note, late]);
  expect(motion()).toBe("queued");
};

it("keeps a streamed animation unseen until the queue reaches it, then paints it and moves on", async () => {
  await arriveBehindBlock([
    animationBlock(`${nodes}<div data-wb-block="note"></div>`),
  ]);

  // Booted and laid out, but unseen while it waits.
  await waitFor(() => expect(slot("Lead note")).toBeTruthy());
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(slot("Lead note")!.style.visibility).toBe("hidden");

  await manualClock.advance(680);
  expect(motion()).toBe("painting");

  // The stage paints and reports it before the cap.
  await waitFor(() => expect(shown("Lead note")).toBe(true));
  await waitFor(() => expect(motion()).toBeUndefined());
});

it("paints a streamed clip in at time 0, as an animation, and moves on", async () => {
  const clip = documentSchema.parse([
    {
      id: "anim",
      type: "clip",
      title: "Paint",
      markers: [
        { key: "a", title: "First" },
        { key: "b", title: "Last" },
      ],
      html: `${nodes}<div id="slot" data-wb-block="note"></div><script>
        whiteboard.clip().marker("a").add("#slot", { translateX: [0, 80], duration: 400 }).marker("b");
      </script>`,
    },
  ])[0]!;

  await render(insert("b1", "markdown"), [before, note, late]);
  await render(insert("anim", "clip"), [before, clip, note, late]);
  expect(motion()).toBe("queued");
  await waitFor(() => expect(slot("Lead note")).toBeTruthy());
  expect(slot("Lead note")!.style.visibility).toBe("hidden");
  const start = new DOMMatrix(slot("Lead note")!.style.transform).m41;

  await manualClock.advance(680);
  expect(motion()).toBe("painting");
  await waitFor(() => expect(shown("Lead note")).toBe(true));
  await waitFor(() => expect(motion()).toBeUndefined());
  // Painted at time 0: nothing has played.
  expect(new DOMMatrix(slot("Lead note")!.style.transform).m41).toBe(start);
});

it("shows an animation loaded with the board at once, without painting", async () => {
  await render(null, [
    animationBlock(`${nodes}<div data-wb-block="note"></div>`),
    note,
  ]);

  expect(motion()).toBeUndefined();
  await waitFor(() => expect(shown("Lead note")).toBe(true));
});

it("shows a data-wb-paint=none element while the rest is still painting", async () => {
  const chips = Array.from(
    { length: 30 },
    (_, index) => `<span class="wb-chip">job ${index}</span>`,
  ).join("");

  await arriveBehindBlock([
    animationBlock(
      `<div data-wb-block="note" data-wb-paint="none"></div><div class="wb-items">${chips}</div><div data-wb-block="late"></div>`,
    ),
  ]);
  await waitFor(() => expect(slot("Late note")).toBeTruthy());

  await manualClock.advance(680);
  await waitFor(() => expect(shown("Lead note")).toBe(true));
  // The last part paints about a second and a half in.
  expect(shown("Late note")).toBe(false);
  expect(motion()).toBe("painting");

  await waitFor(() => expect(shown("Late note")).toBe(true));
  await waitFor(() => expect(motion()).toBeUndefined());
});

it("hands painting to a paint handler and waits for what it returns", async () => {
  await arriveBehindBlock([
    animationBlock(
      `${nodes}<div id="slot" data-wb-block="note"></div><script>
        whiteboard.on("paint", ({ instant }) => {
          document.querySelector("#slot").style.marginLeft = instant ? "0" : "40px";
          return new Promise((done) => setTimeout(done, 1200));
        });
      </script>`,
    ),
  ]);
  await waitFor(() => expect(slot("Lead note")).toBeTruthy());
  const x = () => new DOMMatrix(slot("Lead note")!.style.transform).m41;
  const start = x();

  await manualClock.advance(680);
  // The handler ran with motion, in place of the default painter.
  await waitFor(() => expect(x()).toBe(start + 40));
  expect(shown("Lead note")).toBe(true);
  expect(motion()).toBe("painting");

  await waitFor(() => expect(motion()).toBeUndefined());
});

const offset = () => {
  const x = (text: string) =>
    new DOMMatrix(slot(text)?.style.transform ?? "none").m41;

  return x("Lead note") - x("Late note");
};

const twoSlots = (script: string) =>
  animationBlock(
    `<div id="slot" data-wb-block="note"></div><div data-wb-block="late"></div><script>${script}</script>`,
  );

it("runs a paint handler instantly on a cold load and lands the paint timeline at its end", async () => {
  await render(null, [
    twoSlots(`
      whiteboard.on("paint", ({ instant }) => {
        if (instant) document.querySelector("#slot").style.marginLeft = "40px";
      });
      whiteboard.timeline("paint").add("#slot", { translateX: [0, 20], duration: 300 });
    `),
    note,
    late,
  ]);

  await waitFor(() => expect(offset()).toBe(60));
  expect(motion()).toBeUndefined();
});

it("plays the paint timeline as a streamed animation paints in, then reports it", async () => {
  await arriveBehindBlock([
    twoSlots(`
      whiteboard.timeline("paint").add("#slot", { translateX: [0, 30], duration: 600 });
    `),
  ]);
  await waitFor(() => expect(slot("Late note")).toBeTruthy());

  await manualClock.advance(680);
  await waitFor(() => expect(offset()).toBeGreaterThan(0));
  expect(offset()).toBeLessThan(30);
  await waitFor(() => expect(motion()).toBeUndefined());
  expect(offset()).toBe(30);
});

it("holds nothing under reduced motion", async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  try {
    await render(insert("anim", "animation"), [
      animationBlock(`${nodes}<div data-wb-block="note"></div>`),
      note,
    ]);

    // The queue gives the paint no time, and the stage shows at once.
    await manualClock.advance(0);
    expect(motion()).toBeUndefined();
    await waitFor(() => expect(shown("Lead note")).toBe(true));
  } finally {
    await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  }
});
