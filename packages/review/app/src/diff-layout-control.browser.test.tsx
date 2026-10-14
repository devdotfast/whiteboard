import type { ReviewDiffLayout } from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiffLayoutControl } from "./diff-layout-control";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";

describe("DiffLayoutControl", () => {
  let container: HTMLDivElement;
  let root: Root;
  let layout: ReviewDiffLayout;
  let listeners: Set<(layout: ReviewDiffLayout) => void>;

  let setDiffLayout: ReturnType<
    typeof vi.fn<(next: ReviewDiffLayout) => Promise<void>>
  >;

  let posted: unknown[];

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    layout = "split";
    listeners = new Set();
    posted = [];
    // The desktop writes the setting and reports back through the change
    // event, so the fake applies the write the same way.
    setDiffLayout = vi.fn<(next: ReviewDiffLayout) => Promise<void>>(
      async (next) => {
        confirm(next);
      },
    );

    const session = testReviewSession(
      {},
      {
        currentDiffLayout: () => layout,
        setDiffLayout: (next) => setDiffLayout(next),
        onDidChangeDiffLayout: (listener) => {
          listeners.add(listener);

          return { dispose: () => listeners.delete(listener) };
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

  function confirm(next: ReviewDiffLayout) {
    layout = next;

    for (const listener of listeners) listener(next);
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
    expect(setDiffLayout).toHaveBeenCalledExactlyOnceWith("unified");
    expect(chosen("Diff")).toBe("Unified");
  });

  it("preserves optimistic state, rollback and external setting updates", async () => {
    const write = Promise.withResolvers<void>();
    setDiffLayout.mockImplementation(() => write.promise);
    await act(async () => segment("Diff", "Unified").click());
    expect(chosen("Diff")).toBe("Unified");
    expect(layout).toBe("split");
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
    await act(async () => confirm("unified"));
    expect(chosen("Diff")).toBe("Unified");
  });
});
