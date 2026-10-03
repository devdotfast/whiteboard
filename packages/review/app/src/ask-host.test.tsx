// @vitest-environment jsdom
import type { AskThreadState, AskUpdate } from "@review/ask/thread-state";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

import { AskHistoryProvider } from "./ask-history";
import { readOpenAsks } from "./ask-open-state";
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

/** The threads a watch request follows. */
function watchedThreads(init: RequestInit | undefined): string[] {
  return (JSON.parse(String(init?.body)) as { threads: string[] }).threads;
}

/** A canvas with Ask: an agent named Codex that answers each question in a
 * thread of its own, which the test drives. */
function askCanvas() {
  const session = testReviewSession();
  const streams = new Map<string, (update: AskUpdate) => void>();
  let asked = 0;

  const fetch = vi
    .spyOn(session, "fetch")
    .mockImplementation(async (endpoint, init) => {
      if (endpoint === "/ask/agents")
        return Response.json({
          agents: [{ id: "codex", name: "Codex", available: true }],
        });

      if (endpoint === "/ask/threads") return Response.json({ threads: [] });

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
  document.body.append(container);
  let root = createRoot(container);

  /** Mounts the canvas, with the Asks it last left open, as a tab switched
   * back to or a reload does. */
  const mount = () =>
    act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <ReviewDebugSettingsProvider>
            <ReviewPanelProvider
              restore={() => ({ asks: readOpenAsks(session.config) })}
            >
              <AskHistoryProvider>
                <Probe />
                <ReviewPanelHost />
              </AskHistoryProvider>
            </ReviewPanelProvider>
          </ReviewDebugSettingsProvider>
        </ReviewSessionProvider>,
      ),
    );

  /** The canvas goes, as for another tab. */
  const unmount = async () => {
    await act(async () => root.unmount());
    root = createRoot(container);
  };

  const askQuestion = async (text: string) => {
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
    streams,
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

it("asks before closing an Ask whose agent works, and keeps it going minimized beside a new one", async () => {
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

  // Closing would stop the agent, so it asks first.
  await act(async () => button(/^Close Ask$/)!.click());
  expect(document.body.textContent).toContain("Stop Codex?");
  expect(closed()).toEqual([]);

  // Minimized, the agent keeps going, and the pill says so.
  await act(async () => button(/^Minimize$/)!.click());
  expect(button(/^Open Ask: Codex, Answering/)).not.toBeNull();
  expect(document.querySelector("textarea")).toBeNull();
  expect(closed()).toEqual([]);

  // A new question opens beside it.
  await act(async () => store.getState().openAsk(selection));
  await askQuestion("Why a new index?");
  await act(async () =>
    streams.get("thread-2")!({ seq: 1, snapshot: running("thread-2") }),
  );
  expect(button(/^Open Ask: Codex, Answering/)).not.toBeNull();

  // The first comes back in the window, beside the docked second.
  await act(async () => button(/^Open Ask: Codex, Answering/)!.click());
  expect(
    document.querySelector('[role="dialog"][aria-label="Ask"]'),
  ).not.toBeNull();
  expect(document.querySelector('aside[aria-label="Ask"]')).not.toBeNull();

  // Stopping it is a choice made twice.
  const windowClose = () =>
    document.querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="Ask"] button[aria-label="Close Ask"]',
    )!;

  await act(async () => windowClose().click());
  await act(async () => button(/^Stop and close$/)!.click());
  expect(closed()).toEqual(["/ask/thread-1/close"]);
  expect(
    document.querySelector('[role="dialog"][aria-label="Ask"]'),
  ).toBeNull();

  // Once its agent has answered, an Ask closes at once.
  await act(async () =>
    streams.get("thread-2")!({
      seq: 2,
      snapshot: { ...running("thread-2"), status: "idle" },
    }),
  );
  await act(async () => button(/^Close Ask$/)!.click());
  expect(closed()).toEqual(["/ask/thread-1/close", "/ask/thread-2/close"]);
  expect(document.querySelector("textarea")).toBeNull();
});

it("follows the threads of every open Ask over one connection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();
  const { streams, askQuestion } = canvas;

  await canvas.mount();
  const store = canvas.store();

  // A browser opens only a few connections to a host: a stream for each
  // Ask would soon leave none for the review's other requests.
  for (const [index, question] of ["One?", "Two?", "Three?"].entries()) {
    await act(async () => store.getState().openAsk(selection));
    await askQuestion(question);

    const threadId = `thread-${index + 1}`;

    await act(async () =>
      streams.get(threadId)!({ seq: 1, snapshot: running(threadId) }),
    );
    await act(async () => button(/^Minimize Ask$/)!.click());
  }

  expect(canvas.watching()).toEqual([["thread-1", "thread-2", "thread-3"]]);
});

it("folds two or more minimized Asks into one pill that lists them", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await using canvas = askCanvas();
  const { streams, askQuestion } = canvas;

  await canvas.mount();
  const store = canvas.store();

  const minimize = async (question: string, threadId: string) => {
    await act(async () => store.getState().openAsk(selection));
    await askQuestion(question);
    await act(async () =>
      streams.get(threadId)!({ seq: 1, snapshot: running(threadId) }),
    );
    await act(async () => button(/^Minimize Ask$/)!.click());
  };

  const pills = () =>
    document.querySelectorAll('button[aria-label^="Open Ask: "]');

  // One keeps a pill of its own, which says what it asked about.
  await minimize("One?", "thread-1");
  expect(pills()).toHaveLength(1);
  expect(pills()[0]!.textContent).toContain(
    "\u201cThe index is created concurrently.\u201d",
  );

  // The second folds both into one, which says how many are answering:
  // pills of their own wouldn't tell them apart.
  await minimize("Two?", "thread-2");
  expect(pills()).toHaveLength(0);

  const folded = button(/minimized Asks$/)!;

  expect(folded.textContent).toContain("2 Asks");
  expect(folded.textContent).toContain("2 answering");

  // It lists each, with what it asked about; a row opens that Ask.
  await act(async () => folded.click());
  expect(pills()).toHaveLength(2);
  expect(pills()[0]!.textContent).toContain(
    "\u201cThe index is created concurrently.\u201d",
  );

  await act(async () => (pills()[0] as HTMLButtonElement).click());
  expect(document.querySelector("textarea")).not.toBeNull();
  // One minimized again: its own pill, and no list.
  expect(button(/minimized Asks$/)).toBeNull();
  expect(pills()).toHaveLength(1);
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
