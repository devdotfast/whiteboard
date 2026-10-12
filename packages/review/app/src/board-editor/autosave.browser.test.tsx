import { documentStyles } from "@canvas/document-styles";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import { documentMarker } from "@canvas/markers.stylex";
import { ReviewPanelProvider } from "@canvas/review-panel";
import {
  testApiDocumentData,
  testReviewSession,
} from "@canvas/review-session-test-utils";
import { ReviewApiClient } from "@review/review-api/client";
import * as stylex from "@stylexjs/stylex";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { BoardEditor, BoardEditorHostContext } from "./BoardEditor";
import { BOARDS_FLUSH_EVENT } from "./http-transport";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

interface Save {
  baseVersion: number;
  document: { id?: string; clientKey?: string; markdown?: string }[];
  answer(response: Response): void;
}

/** Saves the fake server is holding, and every block hold it was told. */
const saves: Save[] = [];

/** What a read of a board answers, by its id. */
const boards = new Map<string, unknown>();

const holds: (string | null)[] = [];

const client = new ReviewApiClient(
  { serverUrl: "http://review.test", token: "t" },
  async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}"));

    if (path.endsWith("/focus")) {
      holds.push(body.blockId ?? null);

      return Response.json({});
    }

    if (path.endsWith("/person-edit"))
      return new Promise<Response>((answer) => saves.push({ ...body, answer }));

    if (!init?.method || init.method === "GET") {
      const board = boards.get(path.split("/").at(-1)!);

      return board
        ? Response.json(board)
        : Response.json({ error: "not found" }, { status: 404 });
    }

    return Response.json({});
  },
);

const host = { client, setHeadings: () => {} };

const blocks = (alpha: string) => [
  { id: "a", type: "markdown" as const, markdown: `${alpha}\n` },
  { id: "b", type: "markdown" as const, markdown: "Bravo.\n" },
];

/** The latest hold, which the server refuses an agent's edit to. */
const held = () => holds.at(-1);

const markdownOf = (save: Save, id: string) =>
  save.document.find((block) => block.id === id)?.markdown;

it("saves a block the moment the caret leaves it, holds it until the save lands, and keeps its typing through an agent's version", async () => {
  saves.length = 0;
  holds.length = 0;

  const page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);

  const render = (version: number, alpha: string) => {
    const data = testApiDocumentData(blocks(alpha));

    data.snapshot.version = version;

    return act(async () =>
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
  };

  await render(1, "Alpha.");

  const editor = await vi.waitFor(() => {
    const found = page.querySelector<HTMLElement>(".ProseMirror");

    if (!found) throw new Error("No editor yet");

    return found;
  });

  const paragraph = (text: string) =>
    [...editor.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith(text),
    )!;

  await userEvent.click(paragraph("Alpha"));
  await userEvent.keyboard("{End} Typed.");
  await vi.waitFor(() => expect(held()).toBe("a"));

  // Into B: A saves now, well inside the 800ms autosave pause, and keeps
  // its hold while the save is on its way.
  await userEvent.click(paragraph("Bravo"));
  await vi.waitFor(() => expect(saves).toHaveLength(1), { timeout: 400 });
  expect(markdownOf(saves[0]!, "a")).toBe("Alpha. Typed.\n");
  expect(held()).toBe("a");

  // An agent's version that rewrites A arrives before the save's answer,
  // so the server refuses the save as stale.
  await render(2, "Alpha, as the agent has it.");
  await act(async () =>
    saves[0]!.answer(Response.json({ error: "conflict" }, { status: 409 })),
  );

  // A keeps the person's typing, and their save goes again on the new
  // version and lands as theirs.
  expect(paragraph("Alpha").textContent).toBe("Alpha. Typed.");
  await vi.waitFor(() => expect(saves).toHaveLength(2));
  expect(saves[1]!.baseVersion).toBe(2);
  expect(markdownOf(saves[1]!, "a")).toBe("Alpha. Typed.\n");

  await act(async () =>
    saves[1]!.answer(Response.json({ version: 3, ids: {} })),
  );

  // The hold moves to B once nothing in A is left unsaved.
  await vi.waitFor(() => expect(held()).toBe("b"));
  expect(holds.slice(holds.indexOf("a"))).not.toContain(null);
});

/** A board editor on the page, rendered again with each call. */
function mountEditor() {
  const page = document.createElement("div");

  document.body.append(page);
  root = createRoot(page);

  const render = (data: ReturnType<typeof testApiDocumentData>) =>
    act(async () =>
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

  const paragraph = (text: string) =>
    [...page.querySelectorAll(".ProseMirror p")].find((p) =>
      p.textContent?.startsWith(text),
    ) as HTMLElement;

  return { page, render, paragraph };
}

it("brings back typing a closed board couldn't save, and saves it", async () => {
  saves.length = 0;

  const data = testApiDocumentData(blocks("Alpha."));

  localStorage.setItem(
    `whiteboard:unsaved:${data.snapshot.reviewId}`,
    JSON.stringify({
      baseVersion: data.snapshot.version,
      base: { title: data.snapshot.title, document: blocks("Alpha.") },
      title: data.snapshot.title,
      document: blocks("Alpha. Kept."),
    }),
  );

  const { render, paragraph } = mountEditor();

  await render(data);
  await vi.waitFor(() => expect(paragraph("Alpha. Kept.")).toBeTruthy());
  await vi.waitFor(() => expect(saves).toHaveLength(1), { timeout: 3_000 });
  expect(markdownOf(saves[0]!, "a")).toBe("Alpha. Kept.\n");
  expect(
    localStorage.getItem(`whiteboard:unsaved:${data.snapshot.reviewId}`),
  ).toBeNull();
  await act(async () =>
    saves[0]!.answer(Response.json({ version: 2, ids: {} })),
  );
});

it("saves what's typed when the window asks every board to, and lets it wait for the save", async () => {
  saves.length = 0;

  const { render, paragraph } = mountEditor();

  await render(testApiDocumentData(blocks("Alpha.")));
  await vi.waitFor(() => expect(paragraph("Alpha")).toBeTruthy());
  await userEvent.click(paragraph("Alpha"));
  await userEvent.keyboard("{End} Typed.");

  const waits: Promise<unknown>[] = [];

  window.dispatchEvent(
    new CustomEvent(BOARDS_FLUSH_EVENT, {
      detail: { waitFor: (saved: Promise<unknown>) => waits.push(saved) },
    }),
  );

  // This board's save is the last asked for; a board an earlier test
  // closed may still be saving too.
  await vi.waitFor(() => expect(saves).toHaveLength(1), { timeout: 400 });
  expect(markdownOf(saves[0]!, "a")).toBe("Alpha. Typed.\n");
  await act(async () =>
    saves[0]!.answer(Response.json({ version: 2, ids: {} })),
  );
  await waits.at(-1);
});

it("keeps a new board's first paragraph in the prose column before and after its first save", async () => {
  saves.length = 0;

  const page = document.createElement("article");

  page.style.width = "1000px";
  // The document column the board sits in, as App draws it.
  page.className = stylex.props(
    documentStyles.article,
    documentMarker,
  ).className!;
  document.body.append(page);
  root = createRoot(page);
  await act(async () =>
    root?.render(
      <ReviewSessionProvider session={testReviewSession()}>
        <ReviewPanelProvider>
          <BoardEditorHostContext.Provider value={host}>
            <BoardEditor
              data={testApiDocumentData([])}
              softwareMapEnabled={false}
            />
          </BoardEditorHostContext.Provider>
        </ReviewPanelProvider>
      </ReviewSessionProvider>,
    ),
  );

  const first = () =>
    page.querySelector<HTMLElement>(".ProseMirror [data-board-markdown] p")!;

  const left = (element: Element) => element.getBoundingClientRect().left;

  await vi.waitFor(() => expect(first()).toBeTruthy());
  const title = page.querySelector(".ProseMirror h1")!;
  const empty = left(first());

  expect(empty).toBe(left(title));

  await userEvent.click(first());
  await userEvent.keyboard("First.");
  window.dispatchEvent(new CustomEvent(BOARDS_FLUSH_EVENT));
  await vi.waitFor(() => expect(saves).toHaveLength(1));
  const key = saves[0]!.document[0]!.clientKey!;

  await act(async () =>
    saves[0]!.answer(Response.json({ version: 2, ids: { [key]: "block-1" } })),
  );
  await vi.waitFor(() =>
    expect(page.querySelector('[data-review-node-id="block-1"]')).toBeTruthy(),
  );
  expect(left(first())).toBe(empty);
});
