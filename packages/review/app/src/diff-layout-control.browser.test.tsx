import { TestCanvasQuery } from "@canvas/canvas-query-test-utils";
import type {
  ReviewDiffLayout,
  ReviewDiffLayoutScope,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiffLayoutControl } from "./diff-layout-control";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";

describe("DiffLayoutControl", () => {
  let container: HTMLDivElement;
  let root: Root;
  let layouts: Record<ReviewDiffLayoutScope, ReviewDiffLayout>;

  let listeners: Set<{
    scope: ReviewDiffLayoutScope;
    listener: (layout: ReviewDiffLayout) => void;
  }>;

  let setDiffLayout: ReturnType<
    typeof vi.fn<
      (scope: ReviewDiffLayoutScope, next: ReviewDiffLayout) => Promise<void>
    >
  >;

  let posted: unknown[];
  let showNumbers: boolean;
  let numbersChanged: Set<(show: boolean) => void>;
  let setNumbers: ReturnType<typeof vi.fn<(next: boolean) => Promise<void>>>;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    layouts = { diff: "split", peek: "unified" };
    listeners = new Set();
    posted = [];
    showNumbers = false;
    numbersChanged = new Set();
    setNumbers = vi.fn<(next: boolean) => Promise<void>>(
      async (next: boolean) => {
        showNumbers = next;
        numbersChanged.forEach((listener) => listener(next));
      },
    );
    // The desktop writes the setting and reports back through the change
    // event, so the fake applies the write the same way.
    setDiffLayout = vi.fn<
      (scope: ReviewDiffLayoutScope, next: ReviewDiffLayout) => Promise<void>
    >(async (scope, next) => {
      confirm(scope, next);
    });

    const session = testReviewSession(
      {},
      {
        currentInlineLineNumbers: () => showNumbers,
        setInlineLineNumbers: (show) => setNumbers(show),
        onDidChangeInlineLineNumbers: (listener) => {
          numbersChanged.add(listener);

          return { dispose: () => numbersChanged.delete(listener) };
        },
        currentDiffLayout: (scope) => layouts[scope],
        setDiffLayout: (scope, next) => setDiffLayout(scope, next),
        onDidChangeDiffLayout: (scope, listener) => {
          const entry = { scope, listener };
          listeners.add(entry);

          return { dispose: () => listeners.delete(entry) };
        },
        request: async (url, init) => {
          if (url.includes("/telemetry/event"))
            posted.push(JSON.parse(String(init?.body)));

          return Response.json({ ok: true });
        },
      },
    );

    await act(async () => {
      root.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <DiffLayoutControl />
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      );
    });
    await act(async () => trigger().click());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function confirm(scope: ReviewDiffLayoutScope, next: ReviewDiffLayout) {
    layouts[scope] = next;

    for (const entry of listeners)
      if (entry.scope === scope) entry.listener(next);
  }

  function trigger() {
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Diff settings"]',
    );

    if (!button) throw new Error("Diff settings button not found");

    return button;
  }

  function segment(group: string, label: string) {
    const button = [
      ...container.querySelectorAll<HTMLButtonElement>(
        `[aria-label="${group} layout"] button`,
      ),
    ].find((candidate) => candidate.textContent === label);

    if (!button) throw new Error(`${group} ${label} not found`);

    return button;
  }

  function chosen(group: string) {
    return container.querySelector(
      `[aria-label="${group} layout"] [aria-pressed="true"]`,
    )?.textContent;
  }

  it("writes the shared inline setting, rolls back failed writes, and follows external changes", async () => {
    const buttons = () => [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Whiteboard line numbers"] button',
      ),
    ];

    const show = () =>
      buttons().find((button) => button.textContent === "Show")!;

    const hide = () =>
      buttons().find((button) => button.textContent === "Hide")!;

    expect(hide().getAttribute("aria-pressed")).toBe("true");
    await act(async () => show().click());
    expect(setNumbers).toHaveBeenCalledExactlyOnceWith(true);
    expect(show().getAttribute("aria-pressed")).toBe("true");
    const write = Promise.withResolvers<void>();
    setNumbers.mockImplementation(() => write.promise);
    await act(async () => hide().click());
    expect(hide().getAttribute("aria-pressed")).toBe("true");
    await act(async () => write.reject(new Error("Settings unavailable")));
    expect(show().getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      showNumbers = false;
      numbersChanged.forEach((listener) => listener(false));
    });
    expect(hide().getAttribute("aria-pressed")).toBe("true");
    expect(layouts).toEqual({ diff: "split", peek: "unified" });
  });

  it("writes the chosen layout and does not rewrite the current one", async () => {
    await act(async () => segment("Diff", "Split").click());
    expect(setDiffLayout).not.toHaveBeenCalled();
    await act(async () => segment("Diff", "Unified").click());
    expect(setDiffLayout).toHaveBeenCalledExactlyOnceWith("diff", "unified");
    expect(chosen("Diff")).toBe("Unified");
    expect(chosen("Whiteboard")).toBe("Unified");
  });

  it("sets the code peek layout apart from the diff layout", async () => {
    await act(async () => segment("Whiteboard", "Split").click());
    expect(setDiffLayout).toHaveBeenCalledExactlyOnceWith("peek", "split");
    expect(chosen("Whiteboard")).toBe("Split");
    expect(chosen("Diff")).toBe("Split");
  });

  it("preserves optimistic state, rollback and external setting updates", async () => {
    const write = Promise.withResolvers<void>();
    setDiffLayout.mockImplementation(() => write.promise);
    await act(async () => segment("Diff", "Unified").click());
    expect(chosen("Diff")).toBe("Unified");
    expect(layouts.diff).toBe("split");
    await act(async () => write.reject(new Error("Read-only settings")));
    expect(chosen("Diff")).toBe("Split");
    expect(posted).toContainEqual(
      expect.objectContaining({
        name: "client_error",
        properties: expect.objectContaining({
          error_source: "settings",
          component: "diff_layout",
        }),
      }),
    );
    await act(async () => confirm("diff", "unified"));
    expect(chosen("Diff")).toBe("Unified");
  });
});
