import { AuthoringActivityContext } from "@canvas/authoring-activity-context";
import type { AuthoringCursor } from "@canvas/authoring-cursor";
import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
import { AuthoringCursorContext } from "@canvas/courier";
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
import type { ActivitySnapshot } from "@review/review-api/activity";
import { ReviewApiClient } from "@review/review-api/client";
import { act, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { BoardEditor } from "./BoardEditor";
import { BoardEditorHostContext } from "./host";

import "@canvas/styles.css";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const client = new ReviewApiClient(
  { serverUrl: "http://review.test", token: "t" },
  async () => Response.json({}),
);

const host = { client, setHeadings: () => {} };

const working: ActivitySnapshot = {
  workingCount: 1,
  expiresAt: null,
  activities: [{ activityId: "a", slot: 0 }],
};

const cursor: AuthoringCursor = {
  targetId: "p2",
  blockId: "p2",
  source: "edit",
  seq: 1,
};

it("stands the courier on the block the agent holds", async () => {
  const data = testApiDocumentData([
    { id: "p1", type: "markdown", markdown: "First line.\n" },
    { id: "p2", type: "markdown", markdown: "Second line.\n" },
  ]);

  const article = document.createElement("article");
  article.style.position = "relative";
  const page = document.createElement("div");
  article.append(page);
  document.body.append(article);
  root = createRoot(page);

  const roots: ReviewRoots = {
    appRef: createRef<HTMLDivElement>(),
    shellRef: createRef<HTMLElement>(),
    scrollRegionRef: createRef<HTMLElement>(),
    articleRef: { current: article },
  };

  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={testReviewSession()}>
          <ReviewRootsProvider roots={roots}>
            <ReviewPanelProvider>
              <AuthoringActivityContext.Provider value={working}>
                <AuthoringCursorContext.Provider value={cursor}>
                  <BoardEditorHostContext.Provider value={host}>
                    <BoardEditor data={data} softwareMapEnabled={false} />
                  </BoardEditorHostContext.Provider>
                </AuthoringCursorContext.Provider>
              </AuthoringActivityContext.Provider>
            </ReviewPanelProvider>
          </ReviewRootsProvider>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );

  const block = await vi.waitFor(() => {
    const found = article.querySelector<HTMLElement>(
      '[data-review-node-id="p2"]',
    );

    if (!found) throw new Error("No block yet");

    return found;
  });

  const courier = await vi.waitFor(() => {
    const found = article.querySelector<HTMLElement>(".courier");

    if (!found) throw new Error("No courier");

    return found;
  });

  // He stands on the held block's top edge.
  const figure = courier.getBoundingClientRect();
  const target = block.getBoundingClientRect();

  expect(Math.abs(figure.bottom - target.top)).toBeLessThan(4);
  expect(figure.left).toBeGreaterThanOrEqual(target.left - 20);
  expect(getComputedStyle(courier).visibility).not.toBe("hidden");
});
