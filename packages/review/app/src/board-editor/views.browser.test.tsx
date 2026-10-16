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
