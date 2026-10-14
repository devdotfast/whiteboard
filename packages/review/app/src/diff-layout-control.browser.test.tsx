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

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    layouts = { diff: "split", peek: "unified" };
    listeners = new Set();
    posted = [];
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
        <ReviewSessionProvider session={session}>
          <DiffLayoutControl />
        </ReviewSessionProvider>,
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
