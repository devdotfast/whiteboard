import { ApiDocument } from "@canvas/api-document";
import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
import { ReviewDebugSettingsProvider } from "@canvas/debug-settings";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import { ReviewPanelProvider, useReviewPanelStore } from "@canvas/review-panel";
import type { SourcePeekAnchor } from "@canvas/review-panel-model";
import {
  type ReviewRoots,
  ReviewRootsProvider,
} from "@canvas/review-root-context";
import {
  testApiDocumentData,
  testReviewSession,
} from "@canvas/review-session-test-utils";
import {
  type Block,
  type DiffSelection,
  animationCodeId,
} from "@dev.fast/whiteboard-document";
import { act, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const selection = (line: number): DiffSelection => ({
  file: "order.ts",
  start: { side: "head", line },
  end: { side: "head", line },
});

const lines = { first: 1, second: 2, edge: 3 };

// The stage is sandboxed: it presses its own elements when the test says so.
const html = `<div class="wb-node" id="edge" data-wb-open="edge">reopened</div>
<script>
  const at = { bubbles: true, clientX: 5, clientY: 5 };
  const edge = () => document.querySelector("#edge");

  addEventListener("message", ({ data }) => {
    if (data === "test:click") edge().click();

    if (data === "test:enter")
      edge().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );

    // The drawing's own click handler moves the frame.
    if (data === "test:press-going-to-b") {
      edge().addEventListener("click", () => whiteboard.goto("b"), { once: true });
      edge().dispatchEvent(new PointerEvent("pointerdown", at));
      edge().dispatchEvent(new PointerEvent("pointerup", at));
      edge().click();
    }

    // A frame redraws the element between press and release: no click comes.
    if (data === "test:press-across-redraw") {
      edge().dispatchEvent(new PointerEvent("pointerdown", at));
      edge().replaceWith(edge().cloneNode(true));
      document.body.dispatchEvent(new PointerEvent("pointerup", at));
    }
  });
</script>`;

const blockId = "anim";

const block: Block = {
  id: blockId,
  type: "animation",
  title: "Pull request",
  frames: [
    { key: "a", title: "Opened", code: ["first"], duration: 60000 },
    { key: "b", title: "Merged", code: ["second"], duration: 60000 },
  ],
  html,
  code: { first: "order.ts", second: "order.ts", edge: "order.ts" },
  height: 200,
};

const anchors = new Map<string, SourcePeekAnchor>(
  Object.entries(lines).map(([name, line]) => {
    const id = animationCodeId(blockId, name);

    return [id, { id, title: name, peek: selection(line) }];
  }),
);

let panel: ReturnType<typeof useReviewPanelStore>;

function PanelProbe() {
  panel = useReviewPanelStore();

  return null;
}

let article: HTMLElement, root: Root;

beforeEach(async () => {
  article = document.createElement("article");
  article.style.width = "900px";
  const container = document.createElement("div");
  article.append(container);
  document.body.append(article);
  root = createRoot(container);

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
              <PanelProbe />
              <ReviewRootsProvider roots={roots}>
                <ApiDocument
                  data={{ ...testApiDocumentData([block]), anchors }}
                />
              </ReviewRootsProvider>
            </ReviewPanelProvider>
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  article.remove();
});

const button = (label: string) =>
  article.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const post = (command: string) =>
  article.querySelector("iframe")!.contentWindow!.postMessage(command, "*");

/** The code the reader sees: the open stop's, or the plain peek's. */
const shownLine = () => {
  const { active } = panel.getState();

  const content = active?.tour
    ? active.tour.definition.stops.find(
        (stop) => stop.anchor.id === active.anchor?.id,
      )?.content
    : active?.content;

  return content?.kind === "source" ? content.source.start.line : null;
};

const shows = (line: number) =>
  vi.waitFor(() => expect(shownLine()).toBe(line));

// Pressed until it opens: the stage takes a moment to boot.
const open = (command: string) =>
  vi.waitFor(
    () => {
      post(command);
      expect(shownLine()).toBe(lines.edge);
    },
    { timeout: 5000 },
  );

const press = async (label: string) => {
  await vi.waitFor(() => expect(button(label)).not.toBeNull());
  await act(async () => button(label)!.click());
};

it("opens the clicked code with a tour on, until the reader steps", async () => {
  await open("test:click");

  await press("Next frame");
  await shows(lines.second);

  await open("test:click");
  expect(panel.getState().active?.tour?.definition.id).toBe(blockId);

  await press("Previous frame");
  await shows(lines.first);
});

it("holds the fullscreen tour on its frame, until the reader steps", async () => {
  await press("Next frame");

  const tourButton = [...article.querySelectorAll("button")].find(
    (item) => item.textContent === "Tour",
  );

  await act(async () => tourButton!.click());
  const before = panel.getState().overlayTour!;

  await vi.waitFor(
    () => {
      post("test:click");
      expect(panel.getState().overlayTour?.revealRequest).toBeGreaterThan(
        before.revealRequest,
      );
    },
    { timeout: 5000 },
  );
  expect(panel.getState().overlayTour?.anchor).toBe(before.anchor);

  await press("Previous frame");
  await vi.waitFor(() =>
    expect(panel.getState().overlayTour?.anchor).toBe("anim:frame:a"),
  );
});

it("keeps the code across the frame the drawing's own click goes to", async () => {
  await open("test:press-going-to-b");
  await vi.waitFor(() =>
    expect(panel.getState().active?.anchor?.id).toBe("anim:frame:b"),
  );
  expect(shownLine()).toBe(lines.edge);

  await press("Previous frame");
  await shows(lines.first);
});

it("opens by Enter as by a click", async () => {
  await press("Next frame");
  await open("test:enter");
  expect(shownLine()).toBe(lines.edge);
});

it("opens a press the frame redrew, pausing playback on that code", async () => {
  await press("Play");
  await vi.waitFor(() => expect(button("Pause")).not.toBeNull());

  await open("test:press-across-redraw");
  await vi.waitFor(() => expect(button("Play")).not.toBeNull());

  await press("Next frame");
  await shows(lines.second);
});
