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
    stackSession.review!.stack = async () => ({
      layers: [
        {
          branch: "feature-b",
          relation: "current",
          pullRequestNumber: 20,
          pullRequestUrl: "https://github.com/o/r/pull/20",
          base: null,
          subject: null,
          reviewUuid: "22222222-2222-4222-8222-222222222222",
          reviewTitle: "Review B",
        },
        {
          branch: "feature-c",
          relation: "later",
          pullRequestNumber: 30,
          pullRequestUrl: "https://github.com/o/r/pull/30",
          base: null,
          subject: null,
          reviewUuid: "11111111-1111-4111-8111-111111111111",
          reviewTitle: "Review C",
        },
        {
          branch: "feature-d",
          relation: "later",
          pullRequestNumber: 40,
          pullRequestUrl: "https://github.com/o/r/pull/40",
          base: null,
          subject: null,
          reviewUuid: null,
          reviewTitle: null,
        },
      ],
    });

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
        "Stack, 1 of 3",
      );
    });
    await openMenu(container);

    const layer = container.querySelector<HTMLButtonElement>(
      '[role=menu] button[data-relation="later"]:not(:disabled)',
    );

    expect(layer?.textContent).toContain("#30");
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
  });
  it("creates an empty review for a local branch without one, against the branch below", async () => {
    const post = vi.fn<ReviewCanvasBridge["post"]>(async () => ({ ok: true }));
    const created = "33333333-3333-4333-8333-333333333333";
    const session = testReviewSession({}, { post });

    const createBranchReview = vi.fn<
      (branch: string, base: string, title: string) => Promise<string>
    >(async () => created);

    session.review!.headBranch = "a";
    session.review!.createBranchReview = createBranchReview;
    session.review!.stack = async () => ({
      layers: ["a", "b"].map((branch, index) => ({
        branch,
        relation: index === 0 ? "current" : "later",
        pullRequestNumber: null,
        pullRequestUrl: null,
        base: index === 0 ? "fork" : "a",
        subject: `Add ${branch}`,
        reviewUuid: null,
        reviewTitle: null,
      })),
    });

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <ReviewStackSelector />
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      );
    });

    await vi.waitFor(() => expect(container.textContent).toContain("1 of 2"));
    await openMenu(container);
    expect(container.textContent).toContain("Create");
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[role=menu] button[data-relation="later"]',
        )
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(createBranchReview).toHaveBeenCalledWith("b", "a", "Add b");
    expect(post).toHaveBeenCalledWith({
      name: "openReview",
      args: { reviewUuid: created, active: true },
    });
  });
  it("never shows a slower stack read from a version left behind", async () => {
    const reads: ((stack: { layers: ReviewStackLayer[] }) => void)[] = [];
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
        base: null,
        subject: null,
        reviewUuid:
          `${pullRequestNumber}`.repeat(4) + "-1111-4111-8111-111111111111",
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
    await act(async () => reads[1]!({ layers: layers("Second") }));
    await vi.waitFor(() => expect(container.textContent).toContain("1 of 2"));
    await openMenu(container);
    expect(container.textContent).toContain("Second 30");
    await act(async () => {
      reads[0]!({ layers: layers("First") });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.textContent).not.toContain("First");
  });
  it("lists the stack newest first down to its base, the board on screen opening nothing", async () => {
    const post = vi.fn<ReviewCanvasBridge["post"]>(async () => ({ ok: true }));
    const session = testReviewSession({}, { post });

    session.review!.headBranch = "b";
    session.review!.stack = async () => ({
      base: "main",
      layers: (["a", "b", "c"] as const).map((branch, index) => ({
        branch,
        relation: (["earlier", "current", "later"] as const)[index]!,
        pullRequestNumber: 10 + index,
        pullRequestUrl: `https://github.com/o/r/pull/${10 + index}`,
        base: null,
        subject: null,
        reviewUuid: `${index + 1}`.repeat(8) + "-1111-4111-8111-111111111111",
        reviewTitle: `Review ${branch}`,
        pullRequestState: index === 0 ? "merged" : "open",
      })),
    });

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <ReviewStackSelector />
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      );
    });

    await vi.waitFor(() =>
      expect(container.querySelector("button[aria-haspopup]")?.ariaLabel).toBe(
        "Stack, 2 of 3",
      ),
    );
    await openMenu(container);

    const rows = [...container.querySelectorAll("[role=menuitem]")];

    expect(document.activeElement).toBe(rows[1]);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Review c"),
      expect.stringContaining("Review b"),
      expect.stringMatching(/Review a.*#10 merged/),
    ]);
    expect(
      container.querySelector("[role=separator]")?.nextElementSibling
        ?.textContent,
    ).toContain("main");

    await act(async () => (rows[1] as HTMLElement).click());
    expect(post).not.toHaveBeenCalled();
  });
});
