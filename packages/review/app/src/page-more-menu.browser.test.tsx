import type {
  ReviewCanvasBridge,
  ReviewMenuRequest,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { CanvasUiContext } from "./host/canvas-ui";
import { ReviewSessionProvider } from "./host/review-session";
import { PageMoreMenu } from "./page-more-menu";
import { ReviewProvider } from "./review-context";
import { testReviewSession } from "./review-session-test-utils";

let root: Root | null = null;

/** The last menu the canvas asked the host to show. */
let menu: Omit<ReviewMenuRequest, "anchor" | "onHide"> | undefined;

const ui = {
  showMenu: (request: ReviewMenuRequest) => {
    menu = request;

    return { dispose: () => {} };
  },
};

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

it("moves to Trash once at a time from ⋯, and says so when it fails", async () => {
  const notify = vi.fn<NonNullable<ReviewCanvasBridge["notify"]>>();
  const session = testReviewSession({}, { notify });
  let finish: (() => void) | undefined;

  const dismiss = vi.fn<() => Promise<boolean>>(
    () =>
      new Promise((resolve, reject) => {
        finish = () => reject(new Error("offline"));
      }),
  );

  session.review = { ...session.review!, dismiss };
  vi.spyOn(console, "error").mockImplementation(() => {});

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root?.render(
      <ReviewSessionProvider session={session}>
        <CanvasUiContext.Provider value={ui}>
          <ReviewProvider>
            <PageMoreMenu views={[]} onShowView={() => {}} />
          </ReviewProvider>
        </CanvasUiContext.Provider>
      </ReviewSessionProvider>,
    ),
  );

  const open = () =>
    act(async () =>
      container.querySelector<HTMLElement>('[aria-label="More"]')!.click(),
    );

  await open();
  expect(menu?.items.map((item) => item.label)).toEqual([
    "Move to Trash",
    "Source tree ↗",
  ]);

  // A second pick while the first is saving does nothing.
  const first = act(async () => menu!.onSelect("trash"));

  await act(async () => menu!.onSelect("trash"));
  expect(dismiss).toHaveBeenCalledOnce();

  finish!();
  await first;
  expect(notify).toHaveBeenCalledWith({
    kind: "error",
    text: "Could not move the whiteboard to Trash. Try again.",
  });
});
