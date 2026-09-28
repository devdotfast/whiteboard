import type { ReviewDiffLayout } from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testCanvasUi } from "./canvas-ui-test-utils";
import { DiffLayoutControl } from "./diff-layout-control";
import { CanvasUiContext } from "./host/canvas-ui";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";

describe("DiffLayoutControl", () => {
  let host: ReturnType<typeof testCanvasUi>;
  let container: HTMLDivElement;
  let root: Root;
  let layout: ReviewDiffLayout;
  let listeners: Set<(layout: ReviewDiffLayout) => void>;

  let setDiffLayout: ReturnType<
    typeof vi.fn<(next: ReviewDiffLayout) => Promise<void>>
  >;

  let posted: unknown[];
  let session: ReturnType<typeof testReviewSession>;

  beforeEach(async () => {
    host = testCanvasUi();
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

    session = testReviewSession(
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
        <CanvasUiContext.Provider value={host.ui}>
          <ReviewSessionProvider session={session}>
            <DiffLayoutControl />
          </ReviewSessionProvider>
        </CanvasUiContext.Provider>,
      );
    });
  });

  function confirm(next: ReviewDiffLayout) {
    layout = next;

    for (const listener of listeners) listener(next);
  }

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each(["ArrowDown", "ArrowUp"])(
    "%s opens the host menu only once",
    async (key) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        await act(async () =>
          trigger().dispatchEvent(
            new KeyboardEvent("keydown", { key, bubbles: true }),
          ),
        );
      }

      expect(host.ui.showMenu).toHaveBeenCalledOnce();
      expect(host.menu.items.find((item) => item.checked)?.id).toBe("split");
      expect(setDiffLayout).not.toHaveBeenCalled();
    },
  );

  it("writes the chosen layout and does not rewrite the current one", async () => {
    await act(async () => trigger().click());
    await act(async () => host.select("split"));
    expect(setDiffLayout).not.toHaveBeenCalled();
    await act(async () => trigger().click());
    await act(async () => host.select("unified"));
    expect(setDiffLayout).toHaveBeenCalledExactlyOnceWith("unified");
    await act(async () => trigger().click());
    expect(host.menu.items.find((item) => item.checked)?.id).toBe("unified");
  });

  it("preserves optimistic state, rollback and external setting updates", async () => {
    const write = Promise.withResolvers<void>();
    setDiffLayout.mockImplementation(() => write.promise);
    await act(async () => trigger().click());
    expect(host.menu.items.find((item) => item.checked)?.id).toBe("split");
    await act(async () => host.select("unified"));
    expect(setDiffLayout).toHaveBeenCalledExactlyOnceWith("unified");
    await act(async () => trigger().click());
    expect(host.menu.items.find((item) => item.checked)?.id).toBe("unified");
    expect(layout).toBe("split");
    await act(async () => {
      host.menu.onHide();
      write.reject(new Error("Read-only settings"));
    });
    await act(async () => trigger().click());
    expect(host.menu.items.find((item) => item.checked)?.id).toBe("split");
    expect(posted).toContainEqual(
      expect.objectContaining({
        name: "client_error",
        properties: expect.objectContaining({
          error_source: "settings",
          component: "diff_layout",
        }),
      }),
    );
    await act(async () => {
      host.menu.onHide();
      confirm("unified");
    });
    await act(async () => trigger().click());
    expect(host.menu.items.find((item) => item.checked)?.id).toBe("unified");
  });

  it("leaves the layout unchanged when the host cancels", async () => {
    await act(async () => trigger().click());
    await act(async () => host.menu.onHide());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(setDiffLayout).not.toHaveBeenCalled();
  });

  function trigger() {
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Diff settings"]',
    );

    if (!button) throw new Error("Diff settings button not found");

    return button;
  }
});
