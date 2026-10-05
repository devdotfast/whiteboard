import type {
  ReviewCanvasBridge,
  ReviewStackLayer,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestCanvasQuery } from "./canvas-query-test-utils";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";
import { ReviewStackSelector } from "./review-stack-selector";

let root: Root | null = null;

const openMenu = (container: HTMLElement) =>
  act(async () => {
    container
      .querySelector<HTMLButtonElement>("button[aria-haspopup]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

describe("ReviewStackSelector", () => {
  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }

    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("opens an available later Review in a background tab", async () => {
    const post = vi.fn<ReviewCanvasBridge["post"]>(async () => ({ ok: true }));

    const stackSession = testReviewSession({}, { post });
    stackSession.review!.pullRequestNumber = 20;
    stackSession.review!.stack = async () => [
      {
        branch: "feature-b",
        relation: "current",
        pullRequestNumber: 20,
        pullRequestUrl: "https://github.com/o/r/pull/20",
        reviewUuid: "22222222-2222-4222-8222-222222222222",
        reviewTitle: "Review B",
      },
      {
        branch: "feature-c",
        relation: "later",
        pullRequestNumber: 30,
        pullRequestUrl: "https://github.com/o/r/pull/30",
        reviewUuid: "11111111-1111-4111-8111-111111111111",
        reviewTitle: "Review C",
      },
      {
        branch: "feature-d",
        relation: "later",
        pullRequestNumber: 40,
        pullRequestUrl: "https://github.com/o/r/pull/40",
        reviewUuid: null,
        reviewTitle: null,
      },
    ];

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={stackSession}>
            <ReviewStackSelector />
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await vi.waitFor(() => {
      expect(container.querySelector("button[aria-haspopup]")?.ariaLabel).toBe(
        "Pull request stack, 1 of 3",
      );
    });
    await openMenu(container);

    const unavailable = container.querySelector<HTMLButtonElement>(
      "[role=menu] button:disabled",
    );

    expect(unavailable?.textContent).toContain("PR #40");
    expect(unavailable?.textContent).toContain("No session");

    const layer = container.querySelector<HTMLButtonElement>(
      '[role=menu] button[data-relation="later"]',
    );

    expect(layer?.textContent).toContain("PR #30");
    await act(async () => {
      layer?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, metaKey: true }),
      );
    });
    expect(post).toHaveBeenCalledWith({
      name: "openReview",
      args: {
        reviewUuid: "11111111-1111-4111-8111-111111111111",
        active: false,
      },
    });
    await act(async () => {
      unavailable?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("never shows a slower stack read from a version left behind", async () => {
    const reads: ((layers: ReviewStackLayer[]) => void)[] = [];
    const session = testReviewSession();
    session.review!.pullRequestNumber = 20;
    session.review!.stack = () =>
      new Promise((resolve) => {
        reads.push(resolve);
      });

    const layers = (title: string): ReviewStackLayer[] =>
      [20, 30].map((pullRequestNumber, index) => ({
        branch: `branch-${pullRequestNumber}`,
        relation: index === 0 ? "current" : "later",
        pullRequestNumber,
        pullRequestUrl: `https://github.com/o/r/pull/${pullRequestNumber}`,
        reviewUuid: null,
        reviewTitle: `${title} ${pullRequestNumber}`,
      }));

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    const render = (version: number) =>
      act(async () => {
        root?.render(
          <TestCanvasQuery>
            <ReviewSessionProvider session={session}>
              <DisplayedReviewVersionContext.Provider value={version}>
                <ReviewStackSelector />
              </DisplayedReviewVersionContext.Provider>
            </ReviewSessionProvider>
          </TestCanvasQuery>,
        );
      });

    await render(1);
    await render(2);
    expect(reads).toHaveLength(2);
    await act(async () => reads[1]!(layers("Second")));
    await vi.waitFor(() => expect(container.textContent).toContain("1/2"));
    await openMenu(container);
    expect(container.textContent).toContain("Second 30");
    await act(async () => {
      reads[0]!(layers("First"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.textContent).not.toContain("First");
  });
});
