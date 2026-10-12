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

/** What the editor posted: each route and its JSON body. */
const posts: { path: string; body: { blockId?: string | null } }[] = [];

// A real client over a fake server that answers saves with a new version.
const client = new ReviewApiClient(
  { serverUrl: "http://review.test", token: "t" },
  async (url, init) => {
    const path = new URL(String(url)).pathname;

    posts.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });

    return Response.json(
      path.endsWith("/person-edit") ? { version: 2, ids: {} } : {},
    );
  },
);

const host = { client, setHeadings: () => {} };

/** A board with one paragraph, its saves and focus posts recorded. */
async function mountBoard() {
  posts.length = 0;

  const data = testApiDocumentData([
    { id: "p1", type: "markdown", markdown: "First line.\n" },
  ]);

  // The page around the board, which takes focus when editing ends.
  const page = document.createElement("div");
  page.tabIndex = -1;
  document.body.append(page);
  root = createRoot(page);

  await act(async () =>
    root?.render(
      <ReviewSessionProvider session={testReviewSession()}>
        <ReviewPanelProvider>
          <BoardEditorHostContext.Provider value={host}>
            <BoardEditor data={data} softwareMapEnabled={false} />
          </BoardEditorHostContext.Provider>
        </ReviewPanelProvider>
      </ReviewSessionProvider>,
    ),
  );

  const editor = await vi.waitFor(() => {
    const found = page.querySelector<HTMLElement>(".ProseMirror");

    if (!found) throw new Error("No editor yet");

    return found;
  });

  return { page, editor };
}

it("leaves editing on Esc: the caret goes, the edit saves now, and the block is let go", async () => {
  const { page, editor } = await mountBoard();

  await userEvent.click(editor.querySelector("p")!);
  await userEvent.keyboard("{End} more");
  await vi.waitFor(() =>
    expect(posts.some(({ body }) => body.blockId)).toBe(true),
  );
  posts.length = 0;

  await userEvent.keyboard("{Escape}");

  expect(document.activeElement).toBe(page);
  expect(editor.contains(document.getSelection()?.anchorNode ?? null)).toBe(
    false,
  );
  // Saved at once, not after the autosave pause, and the block released.
  await vi.waitFor(() =>
    expect(posts.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/\/person-edit$/),
        expect.stringMatching(/\/focus$/),
      ]),
    ),
  );
  expect(posts.find(({ path }) => path.endsWith("/focus"))?.body).toMatchObject(
    { blockId: null },
  );

  // A click puts the caret back.
  await userEvent.click(editor.querySelector("p")!);
  expect(document.activeElement).toBe(editor);
});

it("closes the / menu on Esc and stays in the board", async () => {
  const { editor } = await mountBoard();

  await userEvent.click(editor.querySelector("p")!);
  await userEvent.keyboard("{End}{Enter}/");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="listbox"]')).not.toBeNull(),
  );

  await userEvent.keyboard("{Escape}");

  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(editor);
});

it("keeps a key it acts on from the window: ⌘B in text bolds, and the sidebar never sees it", async () => {
  const { editor } = await mountBoard();
  const reached: string[] = [];
  const listen = (event: KeyboardEvent) => reached.push(event.key);

  window.addEventListener("keydown", listen);

  try {
    await userEvent.click(editor.querySelector("p")!);
    await userEvent.keyboard(
      "{End}{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}",
    );
    await userEvent.keyboard("{ControlOrMeta>}b{/ControlOrMeta}");

    expect(editor.querySelector("strong")?.textContent).toBe("line.");
    expect(reached).not.toContain("b");

    // A key the board leaves alone still reaches the window.
    await userEvent.keyboard("{ControlOrMeta>}k{/ControlOrMeta}");
    expect(reached).toContain("k");
  } finally {
    window.removeEventListener("keydown", listen);
  }
});
