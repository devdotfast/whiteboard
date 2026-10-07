import { act } from "react";
import { type Root, createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestCanvasQuery } from "./canvas-query-test-utils";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { ReviewSessionProvider } from "./host/review-session";
import { ReviewDocumentMetaLine } from "./review-doc-meta";
import { testReviewSession } from "./review-session-test-utils";

let root: Root | null = null;

describe("ReviewDocumentMetaLine", () => {
  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }

    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("uses the displayed snapshot's branch and hides it when unavailable", async () => {
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
    expect(container.querySelector('[title^="Head branch"]')).toBeNull();
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
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Updated 5 min ago"),
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

    await render(0);
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Updated 5 min ago"),
    );
    expect(container.querySelector("a")).toBeNull();
    meta = {
      ok: true,
      updatedAtMs: now,
      pullRequestNumber: 310,
      pullRequestUrl: "https://github.com/devdotfast/review/pull/310",
    };
    await render(1);
    await vi.waitFor(() =>
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        meta.pullRequestUrl,
      ),
    );
    expect(container.textContent).toContain("PR #310");
    expect(container.textContent).toContain("Updated just now");
    meta = {
      ok: true,
      updatedAtMs: now,
      pullRequestNumber: null,
      pullRequestUrl: null,
    };
    await render(2);
    await vi.waitFor(() => expect(container.querySelector("a")).toBeNull());
  });

  it.each([
    ["file:///etc/passwd", false],
    ["javascript:alert(1)", false],
    ["https://github.com/o/r/pull/12/../../../evil", false],
    ["https://github.com/o/r/pull/12", true],
    ["https://github.example.com/o/r/pull/12", true],
  ])("links the PR only for a canonical URL: %s", async (url, linked) => {
    const session = testReviewSession();
    session.review = {
      ...session.review!,
      pullRequestNumber: 12,
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

    expect(container.textContent).toContain("PR #12");
    expect(container.querySelector("a")?.getAttribute("href") ?? null).toBe(
      linked ? url : null,
    );
  });

  it.each([
    ["https://github.com/o/r/pull/12", "devbox: o / r·PR #12"],
    [undefined, "devbox"],
  ])("leads with the SSH alias of a remote review: %s", async (url, top) => {
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

    expect(container.querySelector("header > div > div")?.textContent).toBe(
      top,
    );
  });
});
