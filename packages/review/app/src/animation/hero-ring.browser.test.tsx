import { ApiDocument } from "@canvas/api-document";
import { AuthoringActivityContext } from "@canvas/authoring-activity-context";
import { BoardEditor } from "@canvas/board-editor/BoardEditor";
import { BoardEditorHostContext } from "@canvas/board-editor/host";
import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
import { AuthoringCursorContext } from "@canvas/courier";
import { ReviewDebugSettingsProvider } from "@canvas/debug-settings";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import { ReviewPanelProvider } from "@canvas/review-panel";
import {
  type ReviewRoots,
  ReviewRootsProvider,
} from "@canvas/review-root-context";
import {
  testApiDocumentData,
  testReviewSession,
} from "@canvas/review-session-test-utils";
import type { Block } from "@dev.fast/whiteboard-document";
import { ReviewApiClient } from "@review/review-api/client";
import { act, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { HeroContext } from "./hero";

import "@canvas/styles.css";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const working = {
  workingCount: 1,
  expiresAt: null,
  activities: [{ activityId: "a", slot: 0 }],
};

const onHero = {
  targetId: "hero",
  blockId: "hero",
  source: "edit",
  seq: 1,
} as const;

const blocks: Block[] = [
  {
    id: "hero",
    type: "animation",
    title: "Flow",
    frames: [{ key: "a", title: "A client asks" }],
    html: '<div class="wb-node">A</div>',
    code: {},
    height: "auto",
  },
  { id: "p1", type: "markdown", markdown: "Saves retry.\n" },
];

const data = testApiDocumentData(blocks);

/** The hero in a 900px pane, inside a 500px column, with an agent on it. */
async function mountHero() {
  const pane = document.createElement("section");

  pane.className = "review-view-region";
  pane.style.width = "900px";

  const column = document.createElement("div");

  column.style.cssText = "width: 500px; margin-inline: auto";
  pane.append(column);
  document.body.append(pane);
  root = createRoot(column);

  const roots: ReviewRoots = {
    appRef: createRef<HTMLDivElement>(),
    shellRef: createRef<HTMLElement>(),
    scrollRegionRef: { current: pane },
    articleRef: createRef<HTMLElement>(),
  };

  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={testReviewSession()}>
          <ReviewDebugSettingsProvider>
            <ReviewRootsProvider roots={roots}>
              <AuthoringActivityContext.Provider value={working}>
                <AuthoringCursorContext.Provider value={onHero}>
                  <HeroContext.Provider value="hero">
                    <ReviewPanelProvider>
                      <ApiDocument data={data} />
                    </ReviewPanelProvider>
                  </HeroContext.Provider>
                </AuthoringCursorContext.Provider>
              </AuthoringActivityContext.Provider>
            </ReviewRootsProvider>
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );

  const block = await vi.waitFor(() => {
    const found = pane.querySelector<HTMLElement>(
      '[data-review-node-id="hero"][data-region="writing"]',
    );

    if (!found) throw new Error("No ring yet");

    return found;
  });

  return { pane, block, figure: block.querySelector("figure")! };
}

it("rings a working hero on its own box, which runs the pane's width", async () => {
  const { pane, block, figure } = await mountHero();

  // The block's column has no outline to run through the drawing.
  expect(getComputedStyle(block).outlineStyle).toBe("none");
  await vi.waitFor(() =>
    expect(figure.getBoundingClientRect().width).toBe(pane.clientWidth),
  );

  const ring = getComputedStyle(figure, "::before");

  expect(ring.borderTopStyle).toBe("solid");
  // Inside its 1px border, the pane's width.
  expect(ring.width).toBe(`${pane.clientWidth - 2}px`);
});

it("keeps the ring on the hero as the pane resizes", async () => {
  const { pane, figure } = await mountHero();

  pane.style.width = "700px";

  await vi.waitFor(() =>
    expect(getComputedStyle(figure, "::before").width).toBe("698px"),
  );
});

const host = {
  client: new ReviewApiClient(
    { serverUrl: "http://review.test", token: "t" },
    async () => Response.json({}),
  ),
  setHeadings: () => {},
};

it("keeps a selected hero's outline inside the pane", async () => {
  const page = document.createElement("div");

  document.body.append(page);
  root = createRoot(page);

  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={testReviewSession()}>
          <ReviewDebugSettingsProvider>
            <ReviewPanelProvider>
              <BoardEditorHostContext.Provider value={host}>
                <BoardEditor data={data} softwareMapEnabled={false} />
              </BoardEditorHostContext.Provider>
            </ReviewPanelProvider>
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );

  const figure = await vi.waitFor(() => {
    const found = page.querySelector<HTMLElement>("figure[data-hero]");

    if (!found) throw new Error("No hero yet");

    return found;
  });

  await userEvent.click(figure.querySelector("button:not(:disabled)")!);
  await vi.waitFor(() =>
    expect(page.querySelector("[data-board-selected]")).not.toBeNull(),
  );

  expect(
    Number.parseFloat(getComputedStyle(figure).outlineOffset),
  ).toBeLessThan(0);
});
