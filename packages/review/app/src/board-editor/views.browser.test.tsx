import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import { testReviewSession } from "@canvas/review-session-test-utils";
import { TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { createBoardState } from "./editor-state";
import { PortalStore, Portals, nodeViews } from "./views";

let root: Root | null = null;

let view: EditorView | null = null;

afterEach(async () => {
  view?.destroy();
  view = null;

  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }

  document.body.replaceChildren();
});

it("keeps a new board's selected title when the page marks it", async () => {
  const store = new PortalStore();
  const place = document.createElement("div");
  const portals = document.createElement("div");
  document.body.append(place, portals);

  view = new EditorView(place, {
    state: createBoardState({ title: "Untitled", document: [] }),
    nodeViews: nodeViews(store),
  });
  root = createRoot(portals);
  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={testReviewSession()}>
          <Portals store={store} />
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );

  const title = view.dom.querySelector("h1")!;
  view.focus();
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 9)),
  );
  // Marked so the selection toolbar leaves it alone, as a new board does.
  title.setAttribute("data-review-copy-ignore", "");
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(view.dom.querySelector("h1")).toBe(title);
  expect(document.getSelection()?.toString()).toBe("Untitled");
});

it.each(["block", "prose"])(
  "cancels a queued block selection when the next pointer gesture starts on %s",
  async (next) => {
    const { block, editor } = mountCodeBlock();

    const mouse = (type: string, detail: number, buttons: number) =>
      block.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons,
          detail,
        }),
      );

    // A rapid second press can select a native code word before the first
    // click's deferred callback runs. That callback must no longer select it.
    mouse("mousedown", 1, 1);
    mouse("mouseup", 1, 0);
    mouse("click", 1, 0);

    const nextTarget =
      next === "block" ? block : editor.dom.querySelector("p")!;

    nextTarget.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        detail: 2,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
  },
);

function mountCodeBlock() {
  const place = document.createElement("div");
  document.body.append(place);
  view = new EditorView(place, {
    state: createBoardState({
      title: "Gesture",
      document: [
        { id: "code", type: "code", text: "run();", language: "ts" },
        { id: "after", type: "markdown", markdown: "Next paragraph.\n" },
      ],
    }),
    nodeViews: nodeViews(new PortalStore()),
  });

  return {
    block: view.dom.querySelector<HTMLElement>(".review-board-atom")!,
    editor: view,
  };
}

it.each(["shiftKey", "altKey", "ctrlKey", "metaKey"])(
  "leaves %s clicks to the inner block interaction",
  async (modifier) => {
    const { block, editor } = mountCodeBlock();

    for (const type of ["mousedown", "mouseup", "click"])
      block.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === "mousedown" ? 1 : 0,
          detail: 1,
          [modifier]: true,
        }),
      );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
  },
);

it.each(["Escape", "wheel"])(
  "does not restore a queued block selection after %s dismissal",
  async (action) => {
    const { block, editor } = mountCodeBlock();

    for (const type of ["mousedown", "mouseup", "click"])
      block.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: type === "mousedown" ? 1 : 0,
          detail: 1,
        }),
      );
    document.dispatchEvent(
      action === "Escape"
        ? new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        : new WheelEvent("wheel", { deltaY: 100, bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
  },
);
