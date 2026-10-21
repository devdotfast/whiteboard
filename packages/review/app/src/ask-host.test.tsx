// @vitest-environment jsdom
import type {
  ReviewAskState,
  ReviewSurfaceEvent,
} from "@dev.fast/review-protocol";
import type {
  AskHistoryEntry,
  AskThreadState,
  AskUpdate,
} from "@review/ask/thread-state";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import { AskDesktopSync } from "./ask-dock";
import { AskHistoryProvider } from "./ask-history";
import { AskProjectContext, readOpenAsks } from "./ask-open-state";
import { TestCanvasQuery } from "./canvas-query-test-utils";
import { ReviewDebugSettingsProvider } from "./debug-settings";
import { ReviewSessionProvider } from "./host/review-session";
import { ReviewPanelHost } from "./review-components";
import { ReviewProvider } from "./review-context";
import { ReviewPanelProvider, useReviewPanelStore } from "./review-panel";
import type { ReviewPanelStore } from "./review-panel-store";
import { ReviewRootsProvider } from "./review-root-context";
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
  permissions: "read-only",
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

/** The threads a watch request follows. */
function watchedThreads(init: RequestInit | undefined): string[] {
  return (JSON.parse(String(init?.body)) as { threads: string[] }).threads;
}

/** A canvas with Ask: an agent named Codex that answers each question in a
 * thread of its own, which the test drives. The project's saved threads are
 * `threads`; the board on screen is `board`. */
function askCanvas({
  threads = [],
  handedOff = [],
}: {
  threads?: AskHistoryEntry[];
  /** Conversations the review took over as it was created. */
  handedOff?: string[];
} = {}) {
  const surface = new Set<(event: ReviewSurfaceEvent) => void>();
  const reports: ReviewAskState[] = [];

  const session = testReviewSession(
    {},
    {
      subscribe: (listener) => {
        surface.add(listener);

        return { dispose: () => surface.delete(listener) };
      },
      reportAsk: (state) => void reports.push(state),
    },
  );

  const streams = new Map<string, (update: AskUpdate) => void>();
  let asked = 0;

  const fetch = vi
    .spyOn(session, "fetch")
    .mockImplementation(async (endpoint, init) => {
      // Each is handed over once.
      if (endpoint === "/ask/handoff")
        return Response.json({
          threads: handedOff.splice(0).map((id) => ({
            id,
            agent: "codex",
            selection: { title: "Whole review", target: { kind: "review" } },
          })),
        });

      if (endpoint === "/ask/agents")
        return Response.json({
          agents: [{ id: "codex", name: "Codex", available: true }],
        });

      if (endpoint === "/ask/threads")
        return Response.json({ threads, board: "board" });

      if (endpoint === "/ask")
        return Response.json({ threadId: `thread-${++asked}` });

      const opened = /^\/ask\/(.+)\/open$/.exec(String(endpoint))?.[1];

      if (opened) return Response.json({ threadId: opened });

      // Every open Ask follows its thread over one stream; the newest
      // carries each thread's updates.
      if (endpoint === "/ask/watch")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const threadId of watchedThreads(init))
                streams.set(threadId, (update) =>
                  controller.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify({ threadId, update }) + "\n",
                    ),
                  ),
                );
            },
          }),
        );

      return Response.json({ ok: true }, { status: init?.method ? 200 : 404 });
    });

  const requested = (suffix: string) =>
    fetch.mock.calls
      .map(([endpoint]) => String(endpoint))
      .filter((endpoint) => endpoint.endsWith(suffix));

  let store!: ReviewPanelStore;

  function Probe() {
    store = useReviewPanelStore();

    return null;
  }

  const container = document.createElement("div");

  const roots = {
    appRef: { current: null as HTMLDivElement | null },
    shellRef: { current: null },
    scrollRegionRef: { current: null as HTMLElement | null },
    articleRef: { current: null },
  };

  document.body.append(container);
  let root = createRoot(container);

  /** Mounts a board's canvas, with the threads its project last left on
   * screen, as a tab switched to or a reload does. */
  const mount = async (projectId = "payments") => {
    await act(async () =>
      root.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <ReviewRootsProvider roots={roots}>
              <div
                ref={(element) => {
                  roots.appRef.current = element;
                }}
              >
                <section
                  tabIndex={-1}
                  ref={(element) => {
                    roots.scrollRegionRef.current = element;
                  }}
                />
                <ReviewDebugSettingsProvider>
                  <AskProjectContext.Provider value={projectId}>
                    <ReviewPanelProvider
                      restore={() => ({
                        asks: readOpenAsks(session.config, projectId),
                      })}
                    >
                      <ReviewProvider>
                        <AskHistoryProvider>
                          <AskDesktopSync />
                          <Probe />
                          <ReviewPanelHost />
                        </AskHistoryProvider>
                      </ReviewProvider>
                    </ReviewPanelProvider>
                  </AskProjectContext.Provider>
                </ReviewDebugSettingsProvider>
              </div>
            </ReviewRootsProvider>
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      ),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve)));
  };

  /** The canvas goes, as for another tab. */
  const unmount = async () => {
    await act(async () => root.unmount());
    root = createRoot(container);
  };

  const askQuestion = async (text: string) => {
    // The agents land a task after Ask opens.
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    const textarea = document.querySelector("textarea")!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, text);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
  };

  return {
    store: () => store,
    scrollRegion: () => roots.scrollRegionRef.current,
    streams,
    /** Whether Desktop was last told the column is open. */
    docked: () => reports.at(-1)?.docked,
    /** ⌥⌘B, as Desktop sends it. */
    toggle: () =>
      act(async () => {
        for (const listener of surface)
          listener({ event: "toggleAskColumn", reviewId: "board" });
      }),
    closed: () => requested("/close"),
    /** The threads of each watch stream still open. */
    watching: () =>
      fetch.mock.calls
        .filter(
          ([endpoint, init]) =>
            endpoint === "/ask/watch" && !init?.signal?.aborted,
        )
        .map(([, init]) => watchedThreads(init)),
    requested,
    /** What each request to `endpoint` sent. */
    sent: (endpoint: string): unknown[] =>
      fetch.mock.calls
        .filter(([called]) => called === endpoint)
        .map(([, init]) => JSON.parse(String(init?.body))),
    mount,
    unmount,
    askQuestion,
    async [Symbol.asyncDispose]() {
      await act(async () => root.unmount());
      container.remove();
      sessionStorage.clear();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}

it("asks before closing a working thread, and floats one that something replaces", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();
  const { streams, closed, askQuestion } = canvas;

  await canvas.mount();
  const store = canvas.store();

  await act(async () => store.getState().openAsk(selection));
  await askQuestion("Is this safe on replicas?");
  await act(async () =>
    streams.get("thread-1")!({ seq: 1, snapshot: running("thread-1") }),
  );

  // Closing would stop the agent, so it asks first; kept running, it
  // leaves the screen and its agent goes on.
  await act(async () => button(/^Close Ask$/)!.click());
  await act(async () => button(/^Keep running$/)!.click());
  expect(document.querySelector("textarea")).toBeNull();
  expect(closed()).toEqual([]);

  // A peek takes the column from a working thread, which floats.
  await act(async () => store.getState().openAsk(selection));
  await askQuestion("Why a new index?");
  await act(async () =>
    streams.get("thread-2")!({ seq: 1, snapshot: running("thread-2") }),
  );
  await act(async () =>
    store.getState().openPeek({
      kind: "peek",
      content: { kind: "inline-code", text: "start();" },
    }),
  );

  const floating = () =>
    document.querySelector('[role="dialog"][aria-label="Ask"]');

  expect(floating()).not.toBeNull();

  await pressEscape(floating()!.querySelector("textarea")!);
  expect(button(/^Stop and close$/)).not.toBeNull();
  await pressEscape(button(/^Keep running$/)!);
  expect(button(/^Stop and close$/)).toBeNull();
  expect(floating()).not.toBeNull();

  // Stopping it is a choice made twice.
  await act(async () =>
    floating()!
      .querySelector<HTMLButtonElement>('button[aria-label="Close Ask"]')!
      .click(),
  );
  await act(async () => button(/^Stop and close$/)!.click());
  expect(closed()).toEqual(["/ask/thread-2/close"]);
  expect(floating()).toBeNull();
  expect(document.activeElement).toBe(canvas.scrollRegion());

  // Once its agent has answered, a thread closes at once.
  await act(async () => store.getState().openAsk(selection));
  await askQuestion("And the old one?");
  await act(async () =>
    streams.get("thread-3")!({
      seq: 1,
      snapshot: { ...running("thread-3"), status: "idle" },
    }),
  );
  await act(async () => button(/^Close Ask$/)!.click());
  expect(closed()).toEqual(["/ask/thread-2/close", "/ask/thread-3/close"]);
});

it("follows the threads on screen over one connection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();
  const { streams, askQuestion } = canvas;

  await canvas.mount();
  const store = canvas.store();

  // A browser opens only a few connections to a host: a stream for each
  // thread would soon leave none for the review's other requests.
  for (const [index, question] of ["One?", "Two?"].entries()) {
    await act(async () => store.getState().openAsk(selection));
    await askQuestion(question);

    const threadId = `thread-${index + 1}`;

    await act(async () =>
      streams.get(threadId)!({ seq: 1, snapshot: running(threadId) }),
    );
  }

  expect(canvas.watching()).toEqual([["thread-1", "thread-2"]]);
});

it("keeps threads on screen across a project's boards, not another's", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();

  await canvas.mount("payments");
  await act(async () => canvas.store().getState().openAsk(selection));
  await canvas.askQuestion("Is this safe on replicas?");
  await canvas.unmount();

  await canvas.mount("search");
  expect(document.querySelector('aside[aria-label="Ask"]')).toBeNull();
  await canvas.unmount();

  await canvas.mount("payments");
  expect(document.querySelector('aside[aria-label="Ask"]')).not.toBeNull();
  expect(canvas.closed()).toEqual([]);
});

it("leaves an agent working when its canvas goes, and carries on with it when the canvas comes back", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();

  await canvas.mount();
  await act(async () => canvas.store().getState().openAsk(selection));
  await canvas.askQuestion("Is this safe on replicas?");
  await act(async () =>
    canvas.streams.get("thread-1")!({ seq: 1, snapshot: running("thread-1") }),
  );

  // Another tab: the canvas goes, and the agent runs on.
  await canvas.unmount();
  expect(canvas.closed()).toEqual([]);

  // Back again, the Ask is where it was, following the same conversation.
  await canvas.mount();
  expect(canvas.requested("/ask/thread-1/open")).toHaveLength(1);
  await act(async () =>
    canvas.streams.get("thread-1")!({
      seq: 2,
      snapshot: {
        ...running("thread-1"),
        entries: [
          ...running("thread-1").entries,
          { kind: "agent", id: "a", text: "Replicas replay the build." },
        ],
      },
    }),
  );
  expect(
    document.querySelector('aside[aria-label="Ask"]')?.textContent,
  ).toContain("Replicas replay the build.");
  expect(button(/^Close Ask$/)).not.toBeNull();
  expect(canvas.closed()).toEqual([]);
});

it("opens the conversation a review took over as its agent created it in the column, and follows that agent", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas({ handedOff: ["thread-run"] });

  await canvas.mount();
  expect(canvas.requested("/ask/thread-run/open")).toHaveLength(1);
  await act(async () =>
    canvas.streams.get("thread-run")!({
      seq: 1,
      snapshot: {
        ...running("thread-run"),
        entries: [
          { kind: "user", id: "u", text: "Draw this branch.", at: 0 },
          { kind: "agent", id: "a", text: "Adding the sequence diagram." },
        ],
      },
    }),
  );
  // Beside the whiteboard it draws, not over it.
  expect(column()?.textContent).toContain("Adding the sequence diagram.");

  // Only once: the next time the review opens, it is a saved conversation.
  await canvas.unmount();
  await canvas.mount();
  expect(canvas.requested("/ask/handoff")).toHaveLength(2);
  expect(canvas.store().getState().asks).toHaveLength(1);
});

it("starts a conversation about the whole review from its saved conversations", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();

  await canvas.mount();
  await act(async () =>
    canvas.store().getState().openAskView({ type: "history" }),
  );
  await act(async () => button(/^New conversation$/)!.click());
  await canvas.askQuestion("What does this review cover?");

  expect(canvas.sent("/ask")).toMatchObject([
    {
      selection: { title: "Whole review", target: { kind: "review" } },
      question: { text: "What does this review cover?" },
    },
  ]);
});

/** The column's Ask. */
const column = () => document.querySelector('aside[aria-label="Ask"]');

const pressEscape = (target: Element = document.body) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });

/** Types into the open Ask's composer without sending it. */
async function draft(text: string) {
  const textarea = document.querySelector("textarea")!;

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const entry = (
  id: string,
  board: string,
  updatedAt: string,
): AskHistoryEntry => ({
  id,
  agent: "codex",
  title: id,
  selection,
  head: "7fd03b8e2",
  createdAt: updatedAt,
  updatedAt,
  anchor: { board },
});

it("puts the column away with its working thread and brings back the same thread and draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();

  await canvas.mount();
  await act(async () => canvas.store().getState().openAsk(selection));
  await canvas.askQuestion("Is this safe on replicas?");
  await act(async () =>
    canvas.streams.get("thread-1")!({ seq: 1, snapshot: running("thread-1") }),
  );
  await draft("And on the primary?");

  // Away: no question about stopping, and the agent works on.
  await canvas.toggle();
  expect(column()).toBeNull();
  expect(button(/^Stop and close$/)).toBeNull();
  expect(canvas.docked()).toBe(false);
  expect(canvas.closed()).toEqual([]);

  await canvas.toggle();
  expect(canvas.docked()).toBe(true);
  expect(column()?.textContent).toContain("Why?");
  expect(document.querySelector("textarea")?.value).toBe("And on the primary?");
  expect(canvas.requested("/open")).toEqual([]);
  expect(canvas.requested("/ask")).toHaveLength(1);
});

it("keeps the column away across a reload, and brings back what it held", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();

  await canvas.mount();
  await act(async () => canvas.store().getState().openAsk(selection));
  await canvas.askQuestion("Is this safe on replicas?");
  await canvas.toggle();
  await canvas.unmount();

  await canvas.mount();
  expect(column()).toBeNull();
  expect(canvas.docked()).toBe(false);

  await canvas.toggle();
  expect(column()).not.toBeNull();
  expect(canvas.requested("/ask/thread-1/open")).toHaveLength(1);
});

it("marks a thread viewed when it comes on screen with the app focused", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);

  await using canvas = askCanvas({
    threads: [entry("latest", "board", "2026-10-13T11:00:00Z")],
  });

  await canvas.mount();
  await canvas.toggle();
  await vi.waitFor(() =>
    expect(canvas.requested("/viewed")).toEqual(["/ask/latest/viewed"]),
  );
});

it("brings back the board's latest thread when the column held nothing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  await using canvas = askCanvas({
    threads: [
      entry("elsewhere", "other-board", "2026-10-13T12:00:00Z"),
      entry("latest", "board", "2026-10-13T11:00:00Z"),
      entry("older", "board", "2026-10-13T10:00:00Z"),
    ],
  });

  await canvas.mount();
  await canvas.toggle();
  expect(column()).not.toBeNull();
  expect(canvas.requested("/open")).toEqual(["/ask/latest/open"]);

  // The thread on screen is gone: ⌥⌘B shows the latest again.
  await act(async () => button(/^Close Ask$/)!.click());
  await canvas.toggle();
  expect(canvas.requested("/open")).toEqual([
    "/ask/latest/open",
    "/ask/latest/open",
  ]);
});

it("asks about the whole board when it has no threads, and starts none", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  await using canvas = askCanvas({
    threads: [entry("elsewhere", "other-board", "2026-10-13T12:00:00Z")],
  });

  await canvas.mount();
  await canvas.toggle();
  // A question about the whole board quotes nothing.
  expect(column()).not.toBeNull();
  expect(document.querySelector("textarea")).not.toBeNull();

  await canvas.toggle();
  await canvas.toggle();
  expect(column()).not.toBeNull();
  expect(canvas.requested("/ask")).toEqual([]);
  expect(canvas.requested("/open")).toEqual([]);
});

it("closes the peek, not the Ask floating beside it, on an Escape outside the window", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();
  const { streams, askQuestion } = canvas;

  await canvas.mount();
  const store = canvas.store();

  await act(async () => store.getState().openAsk(selection));
  await askQuestion("Is this safe on replicas?");
  await act(async () =>
    streams.get("thread-1")!({ seq: 1, snapshot: running("thread-1") }),
  );
  await act(async () =>
    store.getState().openPeek({
      kind: "peek",
      anchor: { id: "start", title: "start()" },
      content: { kind: "inline-code", text: "start();" },
    }),
  );
  expect(
    document.querySelector('[role="dialog"][aria-label="Ask"]'),
  ).not.toBeNull();

  await pressEscape();
  expect(store.getState().active).toBeNull();
  expect(button(/^Stop and close$/)).toBeNull();
  expect(
    document.querySelector('[role="dialog"][aria-label="Ask"]'),
  ).not.toBeNull();
});

it("puts a peek away too, and brings it back, and only a shown peek closes on Escape", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();

  await canvas.mount();
  await act(async () =>
    canvas
      .store()
      .getState()
      .openPeek({
        kind: "peek",
        anchor: { id: "start", title: "start()" },
        content: { kind: "inline-code", text: "start();" },
      }),
  );
  expect(canvas.docked()).toBe(true);

  await canvas.toggle();
  expect(canvas.docked()).toBe(false);
  expect(column()).toBeNull();

  await pressEscape();
  expect(canvas.store().getState().active).not.toBeNull();

  await canvas.toggle();
  expect(canvas.docked()).toBe(true);
  expect(canvas.store().getState().active).not.toBeNull();

  await pressEscape();
  expect(canvas.store().getState().active).toBeNull();
});
