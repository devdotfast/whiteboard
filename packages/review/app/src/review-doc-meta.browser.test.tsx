import type {
  ReviewBoardPlace,
  ReviewCanvasBridge,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestCanvasQuery } from "./canvas-query-test-utils";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { ReviewSessionProvider } from "./host/review-session";
import { ReviewBreadcrumb } from "./review-breadcrumb";
import {
  BoardSaveRetryContext,
  BoardSaveStatusContext,
  ReviewDocumentMetaLine,
  useBoardPlace,
} from "./review-doc-meta";
import { testReviewSession } from "./review-session-test-utils";

let root: Root | null = null;

// The page bar's breadcrumb over the header's facts, as a board has them.
function PlaceAndFacts() {
  const place = useBoardPlace();

  return (
    <>
      <ReviewBreadcrumb place={place} reviewId="test-review" />
      <ReviewDocumentMetaLine />
    </>
  );
}

describe("ReviewDocumentMetaLine", () => {
  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }

    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("names the displayed snapshot's branch, and the commit when it has none", async () => {
    const session = testReviewSession();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    const render = async (headBranch: string | undefined, version: number) => {
      session.review = { ...session.review!, headBranch };
      await act(async () =>
        root?.render(
          <TestCanvasQuery>
            <ReviewSessionProvider session={session}>
              <DisplayedReviewVersionContext.Provider value={version}>
                <ReviewDocumentMetaLine />
              </DisplayedReviewVersionContext.Provider>
            </ReviewSessionProvider>
          </TestCanvasQuery>,
        ),
      );
    };

    await render("codex/reorganize-homepage-sections", 2);
    expect(container.textContent).toContain(
      "codex/reorganize-homepage-sections",
    );
    await render("feature/earlier-name", 1);
    expect(container.textContent).toContain("feature/earlier-name");
    expect(container.textContent).not.toContain(
      "codex/reorganize-homepage-sections",
    );
    await render(undefined, 0);
    expect(container.textContent).toContain("bbbbbbb");
  });

  it("hydrates when the relative update time changes after SSR", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(Date.UTC(2026, 6, 22, 12, 1));

    const session = testReviewSession();
    session.review!.updatedAtMs = Date.UTC(2026, 6, 22, 12, 0);

    const tree = (
      <TestCanvasQuery>
        <ReviewSessionProvider session={session}>
          <ReviewDocumentMetaLine />
        </ReviewSessionProvider>
      </TestCanvasQuery>
    );

    const serverHtml = renderToString(tree);
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);

    now.mockReturnValue(Date.UTC(2026, 6, 22, 12, 5));

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await act(async () => {
      root = hydrateRoot(container, tree);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      consoleError.mock.calls.map((call) => call.map(String).join(" ")),
    ).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Hydration failed")]),
    );
  });

  it("refreshes PR identity and update time as the displayed version changes without remounting", async () => {
    const now = Date.UTC(2026, 6, 22, 12, 10);
    vi.spyOn(Date, "now").mockReturnValue(now);

    let meta = {
      ok: true,
      updatedAtMs: now - 300_000,
      pullRequestNumber: null as number | null,
      pullRequestUrl: null as string | null,
    };

    const session = testReviewSession();

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    const render = async (version: number) => {
      session.review = {
        ...session.review!,
        updatedAtMs: meta.updatedAtMs,
        pullRequestNumber: meta.pullRequestNumber ?? undefined,
        pullRequestUrl: meta.pullRequestUrl ?? undefined,
      };

      await act(async () => {
        root?.render(
          <TestCanvasQuery>
            <ReviewSessionProvider session={session}>
              <DisplayedReviewVersionContext.Provider value={version}>
                <ReviewDocumentMetaLine />
              </DisplayedReviewVersionContext.Provider>
            </ReviewSessionProvider>
          </TestCanvasQuery>,
        );
      });
    };

    // The PR, by the link it carries.
    const pullRequest = () =>
      container.querySelector<HTMLAnchorElement>(
        'a[href="https://github.com/devdotfast/review/pull/310"]',
      );

    await render(0);

    const before = await vi.waitFor(() => {
      const text = container.textContent;

      expect(text).toBeTruthy();

      return text;
    });

    expect(pullRequest()).toBeNull();
    meta = {
      ok: true,
      updatedAtMs: now,
      pullRequestNumber: 310,
      pullRequestUrl: "https://github.com/devdotfast/review/pull/310",
    };
    await render(1);
    await vi.waitFor(() => expect(pullRequest()).not.toBeNull());
    // The time moved with the version, in the same header.
    expect(container.textContent).not.toBe(before);
    meta = {
      ok: true,
      updatedAtMs: now,
      pullRequestNumber: null,
      pullRequestUrl: null,
    };
    await render(2);
    await vi.waitFor(() => expect(pullRequest()).toBeNull());
  });

  it("places a child under its parent, lists its siblings, and names its PR and branches", async () => {
    const post = vi.fn<ReviewCanvasBridge["post"]>(async () => ({ ok: true }));
    const session = testReviewSession({}, { post });

    const sibling = (reviewId: string, title: string) => ({
      reviewId,
      title,
      icon: "code" as const,
    });

    const place: ReviewBoardPlace = {
      baseBranch: "main",
      pullRequestState: "open",
      parent: { reviewId: "plan", title: "Linked whiteboards", icon: "board" },
      siblings: [
        sibling("kinds", "Board kinds"),
        sibling("test-review", "Links"),
        sibling("threads", "Threads"),
      ],
    };

    session.review = {
      ...session.review!,
      headBranch: "kt/links",
      pullRequestNumber: 612,
      pullRequestUrl: "https://github.com/devdotfast/whiteboard/pull/612",
      place: async () => place,
    };

    const container = document.createElement("div");

    document.body.append(container);
    root = createRoot(container);

    const render = () =>
      act(async () =>
        root?.render(
          <TestCanvasQuery>
            <ReviewSessionProvider session={session}>
              <PlaceAndFacts />
            </ReviewSessionProvider>
          </TestCanvasQuery>,
        ),
      );

    const click = (selector: string) =>
      act(async () => container.querySelector<HTMLElement>(selector)!.click());

    await render();

    const count = '[aria-label="Links, 2 of 3 in Linked whiteboards"]';

    await vi.waitFor(() =>
      expect(container.querySelector(count)).not.toBeNull(),
    );
    // The switcher names the board, then its place.
    expect(container.querySelector(count)!.textContent).toBe("Links·2 of 3");

    await click(count);
    expect(
      [...container.querySelectorAll("[role=menuitem]")].map(
        (row) => row.textContent,
      ),
    ).toEqual([
      expect.stringContaining("Board kinds"),
      expect.stringContaining("Links"),
      expect.stringContaining("Threads"),
    ]);
    expect(
      [...container.querySelectorAll("[role=menuitem]")].map((row) =>
        row.hasAttribute("aria-current"),
      ),
    ).toEqual([false, true, false]);
    await click("[role=menuitem]");
    expect(post).toHaveBeenLastCalledWith({
      name: "openReview",
      args: { reviewUuid: "kinds", active: true },
    });

    await click('[title="Linked whiteboards"]');
    expect(post).toHaveBeenLastCalledWith({
      name: "openReview",
      args: { reviewUuid: "plan", active: true },
    });

    expect(container.querySelector('a[href$="/pull/612"]')).not.toBeNull();
    expect(container.textContent).toContain("kt/links");

    // A lone child names its parent and no count.
    place.siblings = [sibling("test-review", "Links")];
    session.review = { ...session.review!, place: async () => place };
    await render();
    await vi.waitFor(() =>
      expect(container.querySelector("[aria-haspopup=menu]")).toBeNull(),
    );
    expect(container.textContent).toContain("Linked whiteboards");

    // A top-level board names itself, not as a link, and lists its children.
    const top: ReviewBoardPlace = {
      board: { reviewId: "test-review", title: "Stack", icon: "board" },
      siblings: [],
      children: [sibling("kinds", "Board kinds"), sibling("links", "Links")],
    };

    session.review = { ...session.review!, place: async () => top };
    await render();

    const boards = '[aria-label="2 boards in Stack"]';

    await vi.waitFor(() =>
      expect(container.querySelector(boards)?.textContent).toBe("2 boards"),
    );
    expect(container.querySelector('nav button[title="Stack"]')).toBeNull();
    await click(boards);
    expect(
      [...container.querySelectorAll("[role=menuitem]")].map(
        (row) => row.textContent,
      ),
    ).toEqual([
      expect.stringContaining("Board kinds"),
      expect.stringContaining("Links"),
    ]);
    await click("[role=menuitem]:nth-child(2)");
    expect(post).toHaveBeenLastCalledWith({
      name: "openReview",
      args: { reviewUuid: "links", active: true },
    });

    // One child is "1 board".
    top.children = [sibling("links", "Links")];
    session.review = { ...session.review!, place: async () => ({ ...top }) };
    await render();
    await vi.waitFor(() =>
      expect(
        container.querySelector('[aria-label="1 board in Stack"]'),
      ).not.toBeNull(),
    );

    // A board alone names itself, with no menu.
    session.review = {
      ...session.review!,
      place: async () => ({ ...top, children: undefined }),
    };
    await render();
    await vi.waitFor(() =>
      expect(container.querySelector("[aria-haspopup=menu]")).toBeNull(),
    );
    expect(
      container.querySelector('nav[aria-label="Whiteboard"]')?.textContent,
    ).toBe("Stack");
  });

  it.each([["https://github.com/o/r/pull/12"], [undefined]])(
    "leads with the SSH alias of a remote review: %s",
    async (url) => {
      const session = testReviewSession();
      session.review = {
        ...session.review!,
        host: "devbox",
        pullRequestNumber: url ? 12 : undefined,
        pullRequestUrl: url,
      };
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      await act(async () =>
        root?.render(
          <TestCanvasQuery>
            <ReviewSessionProvider session={session}>
              <DisplayedReviewVersionContext.Provider value={0}>
                <ReviewDocumentMetaLine />
              </DisplayedReviewVersionContext.Provider>
            </ReviewSessionProvider>
          </TestCanvasQuery>,
        ),
      );

      expect(
        container.querySelector("header [data-review-copy-ignore]")
          ?.textContent,
      ).toMatch(/^devbox/);
    },
  );

  it("leads the meta line with the board's branch stack, apart from its place", async () => {
    const session = testReviewSession();

    session.review = {
      ...session.review!,
      headBranch: "b",
      place: async () => ({ siblings: [] }),
      stack: async () => ({
        layers: (["a", "b"] as const).map((branch, index) => ({
          branch,
          relation: index ? ("current" as const) : ("earlier" as const),
          pullRequestNumber: null,
          pullRequestUrl: null,
          base: index ? "a" : "main",
          subject: null,
          reviewUuid: null,
          reviewTitle: null,
        })),
      }),
    };

    const container = document.createElement("div");

    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <PlaceAndFacts />
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      ),
    );

    await vi.waitFor(() =>
      expect(
        container.querySelector("header [data-review-copy-ignore]")
          ?.firstElementChild?.textContent,
      ).toContain("Stack2 of 2"),
    );
    expect(container.querySelector("nav")).toBeNull();
  });

  it("says a board is not saved and offers to try again", async () => {
    const session = testReviewSession();
    const retry = vi.fn<() => void>();
    const container = document.createElement("div");

    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <BoardSaveStatusContext.Provider value="failed">
              <BoardSaveRetryContext.Provider value={retry}>
                <ReviewDocumentMetaLine />
              </BoardSaveRetryContext.Provider>
            </BoardSaveStatusContext.Provider>
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      ),
    );

    expect(container.textContent).toContain("Not saved · Retry");
    expect(container.textContent).not.toContain("saving…");
    await act(async () => container.querySelector("button")!.click());
    expect(retry).toHaveBeenCalled();
  });
});
