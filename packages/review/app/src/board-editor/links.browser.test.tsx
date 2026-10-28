import { sourceAnchor } from "@canvas/api-document";
import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import { ReviewPanelProvider, useReviewPanelStore } from "@canvas/review-panel";
import type { ReviewPanelStore } from "@canvas/review-panel-store";
import {
  testApiDocumentData,
  testReviewSession,
} from "@canvas/review-session-test-utils";
import type {
  ReviewNotification,
  ReviewVerbRequest,
} from "@dev.fast/review-protocol";
import { selectionReferences } from "@dev.fast/whiteboard-document";
import { ReviewApiClient } from "@review/review-api/client";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

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

let store: ReviewPanelStore | undefined;

function Store() {
  store = useReviewPanelStore();

  return null;
}

/** A board whose paragraph links a source range and quotes code in it. */
async function mountBoard() {
  const data = testApiDocumentData([
    {
      id: "p1",
      type: "markdown",
      markdown:
        "Read [the saver](whiteboard:source/head/src/save.ts#L2-L4) and [`save()`](whiteboard:source/head/src/save.ts#L6) first.\n",
    },
  ]);

  for (const { id, source, label } of selectionReferences(
    data.snapshot.document,
    { tolerant: true, repositoryId: "repo" },
  ))
    data.anchors.set(id, sourceAnchor(id, source, label ?? id));

  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);

  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={testReviewSession()}>
          <ReviewPanelProvider>
            <Store />
            <BoardEditorHostContext.Provider value={host}>
              <BoardEditor data={data} softwareMapEnabled={false} />
            </BoardEditorHostContext.Provider>
          </ReviewPanelProvider>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );

  return vi.waitFor(() => {
    const found = page.querySelector<HTMLElement>(".ProseMirror");

    if (!found) throw new Error("No editor yet");

    return found;
  });
}

const link = (editor: HTMLElement, text: string) =>
  [...editor.querySelectorAll<HTMLElement>("a[data-href]")].find(
    (element) => element.textContent === text,
  )!;

const washed = (element: HTMLElement) =>
  element.querySelector("[data-review-anchor-open]") !== null;

it("opens a link's peek without a caret, and washes the link while it is open", async () => {
  const editor = await mountBoard();

  await userEvent.click(link(editor, "the saver"));

  expect(store!.getState().active).toMatchObject({ kind: "peek" });
  expect(editor.contains(document.activeElement)).toBe(false);
  expect(editor.contains(document.getSelection()?.anchorNode ?? null)).toBe(
    false,
  );
  await vi.waitFor(() => expect(washed(link(editor, "the saver"))).toBe(true));
  expect(washed(link(editor, "save()"))).toBe(false);

  // A code chip in a link opens its own peek, still without a caret.
  await userEvent.click(link(editor, "save()").querySelector("code")!);
  await vi.waitFor(() => expect(washed(link(editor, "save()"))).toBe(true));
  expect(washed(link(editor, "the saver"))).toBe(false);
  expect(editor.contains(document.activeElement)).toBe(false);

  // Closing the peek drops the wash.
  await act(async () => store!.getState().close());
  await vi.waitFor(() => expect(washed(link(editor, "save()"))).toBe(false));

  // Text beside a link still takes the caret.
  await userEvent.click(editor.querySelector("p")!, {
    position: { x: 2, y: 4 },
  });
  expect(editor.contains(document.activeElement)).toBe(true);
});

it("scrolls to a heading or block on this board in place, without a caret", async () => {
  const filler = Array.from({ length: 80 }, (_, line) => `Line ${line}.`).join(
    "\n\n",
  );

  const data = testApiDocumentData([
    {
      id: "p1",
      type: "markdown",
      markdown:
        "See [the risks](#risks) and [the last line](whiteboard:board/11111111-1111-4111-8111-111111111111#p3).\n",
    },
    { id: "p2", type: "markdown", markdown: `${filler}\n\n## Risks\n` },
    { id: "p3", type: "markdown", markdown: `${filler}\n\nThe last line.\n` },
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

  /** Its top within the window, give or take a heading's margin. */
  const inView = (element: Element) => {
    const { top } = element.getBoundingClientRect();

    return top > -40 && top < window.innerHeight / 2;
  };

  const heading = () =>
    [...editor.querySelectorAll("h2")].find(
      (element) => element.textContent === "Risks",
    )!;

  expect(inView(heading())).toBe(false);
  await userEvent.click(link(editor, "the risks"));
  await vi.waitFor(() => expect(inView(heading())).toBe(true));
  expect(editor.contains(document.activeElement)).toBe(false);

  window.scrollTo(0, 0);

  const block = editor.querySelector('[data-review-node-id="p3"]')!;

  await userEvent.click(link(editor, "the last line"));
  await vi.waitFor(() => expect(inView(block)).toBe(true));
  expect(editor.contains(document.activeElement)).toBe(false);
});

it("strikes a link to a deleted board and refuses to open it", async () => {
  const gone = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333";

  const data = testApiDocumentData([
    {
      id: "p1",
      type: "markdown",
      markdown: `See [the old plan](whiteboard:board/${gone}) and [the other](whiteboard:board/${other}).\n`,
    },
  ]);

  data.boards.set(`${gone}#`, {
    missing: true,
    deletedAt: "2026-10-19T12:00:00.000Z",
  });
  data.boards.set(`${other}#`, { title: "The other", missing: false });

  const posts: ReviewVerbRequest[] = [];
  const notified: ReviewNotification[] = [];

  const session = testReviewSession(
    {},
    {
      post: async (request) => {
        posts.push(request);

        return { ok: true };
      },
      notify: (notification) => {
        notified.push(notification);

        return { dispose() {} };
      },
    },
  );

  const page = document.createElement("div");

  document.body.append(page);
  root = createRoot(page);
  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={session}>
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

  const struck = link(editor, "the old plan");

  expect(struck.querySelector("[data-unavailable]")).not.toBeNull();
  expect(link(editor, "the other").querySelector("[data-unavailable]")).toBe(
    null,
  );

  await userEvent.click(struck);
  expect(posts).toEqual([]);
  expect(notified.map(({ kind, text }) => [kind, text])).toEqual([
    ["error", expect.stringMatching(/^Board deleted/)],
  ]);
  expect(editor.contains(document.activeElement)).toBe(false);

  await userEvent.click(link(editor, "the other"));
  await vi.waitFor(() =>
    expect(posts.map(({ name }) => name)).toEqual(["openReview"]),
  );
});
