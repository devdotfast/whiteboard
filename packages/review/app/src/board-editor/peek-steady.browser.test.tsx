import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
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

import { BoardEditor, BoardEditorHostContext } from "./BoardEditor";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const peek = "head/order.ts#L1";

// Each version's progress answers a moment after it is asked for, as the
// server's does while it reads the new version.
const client = new ReviewApiClient(
  { serverUrl: "http://review.test", token: "t" },
  async (url) => {
    const path = new URL(String(url)).pathname;

    if (!path.endsWith("/progress")) return Response.json({});
    await new Promise((resolve) => setTimeout(resolve, 30));

    return Response.json({
      files: [],
      lenses: [],
      complete: true,
      resolvedSelections: {
        [selectionKey(anchorSelection(peek))]: [
          { file: "order.ts", side: "head", fromLine: 1, toLine: 1 },
        ],
      },
    });
  },
);

const host = { client, setHeadings: () => {} };

const blocks = (added: number) => [
  { id: "block-1", type: "code_peek" as const, source: peek },
  ...Array.from({ length: added }, (_, index) => ({
    id: `added-${index + 1}`,
    type: "markdown" as const,
    markdown: `Added ${index + 1}.\n`,
  })),
];

it("keeps an unchanged code peek on screen, with its code, while an agent adds blocks", async () => {
  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);

  const session = testReviewSession();

  const render = (version: number) => {
    const data = testApiDocumentData(blocks(version - 1));

    data.snapshot.version = version;

    return act(async () =>
      root?.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
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
  };

  await render(1);

  const card = () => page.querySelector<HTMLElement>(".code-peek");

  await vi.waitFor(() =>
    expect(card()?.dataset.codeRendering).toBe("inline-editor"),
  );
  const shown = card();
  const atom = shown!.closest(".review-board-atom");

  // Every change to the peek from here on, watched as it happens.
  const loading: string[] = [];

  const observer = new MutationObserver(() => {
    if (page.textContent?.includes("Loading code…"))
      loading.push(page.textContent);
  });

  observer.observe(page, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  for (let version = 2; version <= 6; version++) {
    await render(version);
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
  }

  observer.disconnect();
  expect(page.textContent).toContain("Added 5.");
  expect(loading).toEqual([]);
  expect(card()).toBe(shown);
  expect(card()!.closest(".review-board-atom")).toBe(atom);
});
