import {
  type JsonObject,
  type ReviewCanvasTutorialBridge,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ReviewSessionProvider } from "./host/review-session";
import { ReviewProvider } from "./review-context";
import { testReviewSession } from "./review-session-test-utils";
import { TutorialProvider } from "./tutorial-context";
import { TutorialViewButton } from "./tutorial-dynamic-content";

const session = testReviewSession(
  {},
  { request: async () => jsonResponse({ ok: true }) },
);

const tutorial: ReviewCanvasTutorialBridge = {
  content: {
    reviewUuid: "tutorial-review",
    progress: { version: 1, checked: [], dismissed: false },
    keymap: "none",
  },
  setStep() {},
  dismiss() {},
  reopen() {},
  async selectKeymap() {},
  close() {},
};

describe("tutorial dynamic content", () => {
  it("opens the native Diff view", () => {
    const container = document.createElement("div");
    const nativeView = document.createElement("button");
    nativeView.className = "review-segment";
    nativeView.setAttribute("aria-label", "Diff");
    const openView = vi.fn<() => void>();
    nativeView.addEventListener("click", openView);
    document.body.append(nativeView, container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <ReviewSessionProvider session={session}>
          <ReviewProvider>
            <TutorialProvider tutorial={tutorial}>
              <TutorialViewButton view="diff">Open the diff</TutorialViewButton>
            </TutorialProvider>
          </ReviewProvider>
        </ReviewSessionProvider>,
      );
    });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    act(() => button?.click());
    expect(openView).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    document.body.replaceChildren();
  });
});

function jsonResponse(body: JsonObject): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}
