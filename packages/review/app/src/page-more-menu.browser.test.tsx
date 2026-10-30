import type {
  ReviewApiClient,
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
import { ReviewCornerAction } from "./review-corner-action";
import { testReviewSession } from "./review-session-test-utils";
import { SharingContext } from "./share-control";

let root: Root | null = null;

// SAFETY: the menu never calls the client.
const shareable = { client: {} as ReviewApiClient, reviewId: "r1", version: 3 };

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
  // Files share the page: a console spy left in place keeps the calls it
  // caught, and a later file's spy on console.error is this same one.
  vi.restoreAllMocks();
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

it("keeps the corner's Move to Trash enabled and focused while the move is in flight", async () => {
  const session = testReviewSession();
  const dismiss = vi.fn<() => Promise<boolean>>(() => new Promise(() => {}));

  session.review = { ...session.review!, dismiss };

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root?.render(
      <ReviewSessionProvider session={session}>
        <ReviewProvider>
          <ReviewCornerAction />
        </ReviewProvider>
      </ReviewSessionProvider>,
    ),
  );

  const button = container.querySelector("button")!;
  button.focus();
  await act(async () => button.click());
  await act(async () => button.click());

  expect(dismiss).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(document.activeElement).toBe(button);
});

it("offers Export file… while the board can be shared, and asks the host to write it", async () => {
  const post = vi.fn<ReviewCanvasBridge["post"]>(async () => ({ ok: true }));
  const session = testReviewSession({}, { post });

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root?.render(
      <ReviewSessionProvider session={session}>
        <CanvasUiContext.Provider value={ui}>
          <ReviewProvider>
            <SharingContext.Provider value={shareable}>
              <PageMoreMenu views={[]} onShowView={() => {}} />
            </SharingContext.Provider>
          </ReviewProvider>
        </CanvasUiContext.Provider>
      </ReviewSessionProvider>,
    ),
  );

  await act(async () =>
    container.querySelector<HTMLElement>('[aria-label="More"]')!.click(),
  );
  expect(menu?.items.map((item) => item.label)).toContain("Export file…");

  await act(async () => menu!.onSelect("export"));
  expect(post).toHaveBeenCalledWith({
    name: "exportReviewFile",
    args: { reviewId: "r1", version: 3 },
  });
});
