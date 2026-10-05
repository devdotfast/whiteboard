// @vitest-environment jsdom
import type { AskThreadState, AskUpdate } from "@review/ask/thread-state";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import { AskHistoryProvider } from "./ask-history";
import { ReviewDebugSettingsProvider } from "./debug-settings";
import { ReviewSessionProvider } from "./host/review-session";
import { ReviewPanelHost } from "./review-components";
import { ReviewPanelProvider, useReviewPanelStore } from "./review-panel";
import type { ReviewPanelStore } from "./review-panel-store";
import { testReviewSession } from "./review-session-test-utils";

// jsdom lays nothing out, so nothing resizes or scrolls.
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollTo = () => {};
});

const selection = {
  title: "Paragraph 3",
  target: {
    kind: "text" as const,
    quote: "The index is created concurrently.",
  },
};

const running = (id: string): AskThreadState => ({
  id,
  agent: "codex",
  agentName: "Codex",
  status: "running",
  readOnly: true,
  bypass: false,
  head: "7fd03b8e2",
  cwd: "/checkouts/payments-service",
  selection: { title: "Paragraph 3" },
  entries: [{ kind: "user", id: "u", text: "Why?", at: Date.now() }],
});

/** The button whose accessible name matches. */
function button(name: RegExp) {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) =>
        name.test(
          candidate.getAttribute("aria-label") ??
            candidate.textContent?.trim() ??
            "",
        ),
    ) ?? null
  );
}

it("asks before closing an Ask whose agent works, and keeps it going minimized", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = testReviewSession();
  let push!: (update: AskUpdate) => void;

  const fetch = vi
    .spyOn(session, "fetch")
    .mockImplementation(async (endpoint, init) => {
      if (endpoint === "/ask/agents")
        return Response.json({
          agents: [{ id: "codex", name: "Codex", available: true }],
        });

      if (endpoint === "/ask/threads") return Response.json({ threads: [] });

      if (endpoint === "/ask") return Response.json({ threadId: "thread" });

      if (endpoint === "/ask/thread/watch")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              push = (update) =>
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(update) + "\n"),
                );
            },
          }),
        );

      return Response.json({ ok: true }, { status: init?.method ? 200 : 404 });
    });

  const closed = () =>
    fetch.mock.calls
      .map(([endpoint]) => String(endpoint))
      .filter((endpoint) => endpoint.endsWith("/close"));

  let store!: ReviewPanelStore;

  function Probe() {
    store = useReviewPanelStore();

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <ReviewDebugSettingsProvider>
            <ReviewPanelProvider>
              <AskHistoryProvider>
                <Probe />
                <ReviewPanelHost />
              </AskHistoryProvider>
            </ReviewPanelProvider>
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>,
      ),
    );

    await act(async () => store.getState().openAsk(selection));

    const textarea = document.querySelector("textarea")!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "Is this safe on replicas?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    await act(async () => push({ seq: 1, snapshot: running("thread") }));

    // Closing would stop the agent, so it asks first.
    await act(async () => button(/^Close Ask$/)!.click());
    expect(document.body.textContent).toContain("Stop Codex?");
    expect(closed()).toEqual([]);

    // Minimized, the agent keeps going, and the pill says so.
    await act(async () => button(/^Minimize$/)!.click());
    expect(button(/^Open Ask: Codex, Answering/)).not.toBeNull();
    expect(closed()).toEqual([]);

    // Stopping it is a choice made twice.
    await act(async () => button(/^Open Ask: Codex, Answering/)!.click());
    await act(async () => button(/^Close Ask$/)!.click());
    await act(async () => button(/^Stop and close$/)!.click());
    expect(closed()).toEqual(["/ask/thread/close"]);
    expect(document.querySelector("textarea")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("closes an Ask at once once its agent has answered", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = testReviewSession();
  let push!: (update: AskUpdate) => void;

  const fetch = vi
    .spyOn(session, "fetch")
    .mockImplementation(async (endpoint, init) => {
      if (endpoint === "/ask/agents")
        return Response.json({
          agents: [{ id: "codex", name: "Codex", available: true }],
        });

      if (endpoint === "/ask/threads") return Response.json({ threads: [] });

      if (endpoint === "/ask/saved/open")
        return Response.json({ threadId: "saved" });

      if (endpoint === "/ask/saved/watch")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              push = (update) =>
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(update) + "\n"),
                );
            },
          }),
        );

      return Response.json({ ok: true }, { status: init?.method ? 200 : 404 });
    });

  let store!: ReviewPanelStore;

  function Probe() {
    store = useReviewPanelStore();

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <ReviewDebugSettingsProvider>
            <ReviewPanelProvider>
              <AskHistoryProvider>
                <Probe />
                <ReviewPanelHost />
              </AskHistoryProvider>
            </ReviewPanelProvider>
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>,
      ),
    );

    await act(async () =>
      store.getState().openAskView({
        type: "saved",
        threadId: "saved",
        selection,
        agent: "codex",
      }),
    );
    await act(async () =>
      push({ seq: 1, snapshot: { ...running("saved"), status: "idle" } }),
    );

    await act(async () => button(/^Close Ask$/)!.click());
    expect(document.body.textContent).not.toContain("Stop Codex?");
    expect(store.getState().ask).toBeNull();
    expect(
      fetch.mock.calls.filter(([endpoint]) => endpoint === "/ask/saved/close"),
    ).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
