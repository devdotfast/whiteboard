import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import { ReviewPanelProvider } from "@canvas/review-panel";
import {
  testApiDocumentData,
  testReviewSession,
} from "@canvas/review-session-test-utils";
import { ReviewApiClient } from "@review/review-api/client";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { BoardEditor, BoardEditorHostContext } from "./BoardEditor";

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

const mod = /Mac/.test(navigator.platform) ? "Meta" : "Control";

async function mountSettled() {
  const data = testApiDocumentData([
    { id: "p1", type: "markdown", markdown: "One line.\n\n- [ ] task\n" },
  ]);

  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);

  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={testReviewSession()}>
          <ReviewPanelProvider>
            <BoardEditorHostContext.Provider value={host}>
              <BoardEditor data={data} softwareMapEnabled={false} />
            </BoardEditorHostContext.Provider>
          </ReviewPanelProvider>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );

  const editor = await vi.waitFor(() => {
    const found = page.querySelector<HTMLElement>(".ProseMirror");

    if (!found) throw new Error("No editor yet");

    return found;
  });

  await vi.waitFor(() =>
    expect(editor.hasAttribute("data-board-settled")).toBe(true),
  );

  return editor;
}

function unsettles(editor: HTMLElement) {
  let count = 0;

  new MutationObserver((records) => {
    count += records.filter((record) => record.oldValue !== null).length;
  }).observe(editor, {
    attributes: true,
    attributeFilter: ["data-board-settled"],
    attributeOldValue: true,
  });

  return () => count;
}

const frames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

it("stays settled through bold and a ticked task, and re-measures for a new line", async () => {
  const editor = await mountSettled();
  const unsettled = unsettles(editor);

  await userEvent.click(editor.querySelector("p")!);
  await userEvent.keyboard("{End}{Shift>}{Home}{/Shift}");
  await userEvent.keyboard(`{${mod}>}b{/${mod}}`);
  expect(editor.querySelector("strong")).not.toBeNull();
  await frames();
  expect(unsettled()).toBe(0);

  await userEvent.click(editor.querySelector<HTMLInputElement>("li input")!);
  expect(editor.querySelector<HTMLInputElement>("li input")!.checked).toBe(
    true,
  );
  await frames();
  expect(unsettled()).toBe(0);

  await userEvent.click(editor.querySelector("p")!);
  await userEvent.keyboard("{End}{Enter}");
  await vi.waitFor(() => expect(unsettled()).toBe(1));
  await vi.waitFor(() =>
    expect(editor.hasAttribute("data-board-settled")).toBe(true),
  );
});
