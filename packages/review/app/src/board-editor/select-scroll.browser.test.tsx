import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
import { routeDocumentEmbedScroll } from "@canvas/document-embed-scroll";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import { ReviewLensesProvider } from "@canvas/review-lenses";
import { ReviewPanelProvider } from "@canvas/review-panel";
import {
  testApiDocumentData,
  testReviewSession,
} from "@canvas/review-session-test-utils";
import { anchorSelection, selectionKey } from "@review/lens-selection";
import { ReviewApiClient } from "@review/review-api/client";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { BoardEditor } from "./BoardEditor";
import { BoardEditorHostContext } from "./host";

let root: Root | null = null;

let stop: (() => void) | undefined;

afterEach(async () => {
  stop?.();
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const peekSource = "head/order.ts#L1";

const client = new ReviewApiClient(
  { serverUrl: "http://review.test", token: "t" },
  async (url) =>
    Response.json(
      new URL(String(url), "http://localhost").pathname.endsWith("/progress")
        ? {
            files: [],
            lenses: [],
            complete: true,
            resolvedSelections: {
              [selectionKey(anchorSelection(peekSource))]: [
                { file: "order.ts", side: "head", fromLine: 1, toLine: 1 },
              ],
            },
          }
        : {},
    ),
);

const host = { client, setHeadings: () => {} };

it("selects a code peek and hands it the scroll on one click, wherever the click lands", async () => {
  // The page's scroll region, as App routes wheel gestures in it.
  const region = document.createElement("section");

  region.style.cssText = "height:400px;overflow:auto;line-height:20px";
  document.body.append(region);
  stop = routeDocumentEmbedScroll(region);

  // The board sits in the page's document, as App lays it out.
  const article = document.createElement("article");
  const page = document.createElement("div");

  article.className = "review-document";
  article.append(page);
  region.append(article);
  root = createRoot(page);

  const data = testApiDocumentData([
    { id: "p1", type: "markdown", markdown: "Before.\n" },
    { id: "peek", type: "code_peek", source: peekSource },
    ...Array.from({ length: 40 }, (_, index) => ({
      id: `after-${index}`,
      type: "markdown" as const,
      markdown: `After ${index}.\n`,
    })),
  ]);

  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={testReviewSession()}>
          <ReviewPanelProvider>
            <ReviewLensesProvider client={client} snapshot={data.snapshot}>
              <BoardEditorHostContext.Provider value={host}>
                <BoardEditor data={data} softwareMapEnabled={false} />
              </BoardEditorHostContext.Provider>
            </ReviewLensesProvider>
          </ReviewPanelProvider>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );

  const peek = await vi.waitFor(() => {
    const found = page.querySelector<HTMLElement>(".code-peek");

    if (!found) throw new Error("No peek yet");

    return found;
  });

  // A click on the block's frame, which takes no focus inside it.
  const block = peek.closest<HTMLElement>(".review-board-atom")!;

  await act(async () => {
    for (const type of ["mousedown", "mouseup", "click"])
      block.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          detail: 1,
          buttons: type === "mousedown" ? 1 : 0,
        }),
      );
  });
  await vi.waitFor(() =>
    expect(
      page.querySelector(".code-peek")!.closest("[data-board-selected]"),
    ).not.toBeNull(),
  );

  const before = region.scrollTop;

  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 120,
  });

  page.querySelector(".code-peek")!.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(region.scrollTop).toBe(before);
});

it("selects the block even when what was clicked keeps its mousedown to itself", async () => {
  const page = document.createElement("div");

  document.body.append(page);
  root = createRoot(page);

  const data = testApiDocumentData([
    { id: "peek", type: "code_peek", source: peekSource },
  ]);

  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={testReviewSession()}>
          <ReviewPanelProvider>
            <ReviewLensesProvider client={client} snapshot={data.snapshot}>
              <BoardEditorHostContext.Provider value={host}>
                <BoardEditor data={data} softwareMapEnabled={false} />
              </BoardEditorHostContext.Provider>
            </ReviewLensesProvider>
          </ReviewPanelProvider>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );

  const peek = await vi.waitFor(() => {
    const found = page.querySelector<HTMLElement>(".code-peek");

    if (!found) throw new Error("No peek yet");

    return found;
  });

  // As a code editor does with a click in its text.
  peek.addEventListener("mousedown", (event) => event.stopPropagation());
  await act(async () => {
    for (const type of ["mousedown", "mouseup", "click"])
      peek.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          detail: 1,
          buttons: type === "mousedown" ? 1 : 0,
        }),
      );
  });

  await vi.waitFor(() =>
    expect(
      page.querySelector(".code-peek")!.closest("[data-board-selected]"),
    ).not.toBeNull(),
  );
});
