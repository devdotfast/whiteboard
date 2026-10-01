// @vitest-environment jsdom
import type { AskThreadState, AskUpdate } from "@review/ask/thread-state";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import {
  AskDeleteThreadButton,
  AskOpenThreadProvider,
  useShowOpenThread,
} from "./ask-delete";
import { AskHistoryProvider, useAskHistory } from "./ask-history";
import { AskHistoryList, AskPanelContent } from "./ask-panel";
import { ReviewSessionProvider } from "./host/review-session";
import { ReviewPanelProvider, useReviewPanel } from "./review-panel";
import { testReviewSession } from "./review-session-test-utils";

const selection = {
  title: "Paragraph 3",
  target: {
    kind: "text" as const,
    quote: "The index is created concurrently.",
  },
};

const state = (change: Partial<AskThreadState>): AskThreadState => ({
  id: "thread",
  agent: "claude",
  agentName: "Claude Code",
  status: "running",
  readOnly: true,
  head: "7fd03b8e2",
  cwd: "/checkouts/payments-service",
  selection: { title: "Paragraph 3" },
  entries: [],
  ...change,
});

// jsdom lays nothing out, so it has no element scrolling; asking jumps the
// thread to the newest.
Element.prototype.scrollTo = () => {};

function buttonNamed(container: HTMLElement, name: string) {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === name,
    ) ?? null
  );
}

/** The line that says what the agent is doing, and for how long. */
function working(container: HTMLElement) {
  return (
    [...container.querySelectorAll('[role="status"]')].find((status) =>
      /\d+s$/.test(status.textContent ?? ""),
    ) ?? null
  );
}

it("asks the chosen agent, streams its answer, relays a decision, and closes the agent when the panel goes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = testReviewSession();
  // Each watch request opens a new stream; `push` writes to the newest.
  let push!: (update: AskUpdate) => void;
  let watches = 0;

  const watch = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        watches += 1;
        push = (update) =>
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify(update) + "\n"),
          );
      },
    });

  const fetch = vi
    .spyOn(session, "fetch")
    .mockImplementation(async (endpoint, init) => {
      if (endpoint === "/ask/agents")
        return Response.json({
          agents: [
            { id: "claude", name: "Claude Code", available: false },
            { id: "codex", name: "Codex", available: true },
          ],
        });

      if (endpoint === "/ask") return Response.json({ threadId: "thread" });

      if (endpoint === "/ask/thread/watch") return new Response(watch());

      return Response.json({ ok: true }, { status: init?.method ? 200 : 404 });
    });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const posted = (endpoint: string) =>
    fetch.mock.calls
      .filter(([called]) => called === endpoint)
      .map(([, init]) =>
        init?.body ? JSON.parse(String(init.body)) : init?.method,
      );

  try {
    await act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <AskPanelContent selection={selection} />
        </ReviewSessionProvider>,
      ),
    );

    const textarea = container.querySelector("textarea")!;

    const picker = () =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="menu"]:not([aria-label])',
      )!;

    // Only an installed agent can be chosen, so Codex answers.
    expect(picker().textContent).toBe("Codex");

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;

      setValue.call(textarea, "Is this safe on replicas?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );

    // Codex has not run before, so there is nothing to pick yet.
    expect(posted("/ask")).toEqual([
      {
        agent: "codex",
        question: { text: "Is this safe on replicas?" },
        selection,
        picks: {},
      },
    ]);

    await act(async () =>
      push({
        seq: 3,
        snapshot: state({
          agent: "codex",
          agentName: "Codex",
          status: "waiting",
          entries: [
            {
              kind: "user",
              id: "u",
              text: "Is this safe on replicas?",
              at: Date.now(),
            },
            {
              kind: "agent",
              id: "a",
              text: "Replicas replay the index build.",
            },
            {
              kind: "permission",
              id: "call",
              title: "pnpm db:migrate --dry-run",
              toolKind: "execute",
              options: [
                { optionId: "allow", name: "Allow once", kind: "allow_once" },
                { optionId: "deny", name: "Deny", kind: "reject_once" },
              ],
            },
          ],
        }),
      }),
    );

    expect(container.textContent).toContain("Replicas replay the index build.");
    expect(picker().disabled).toBe(true);

    const allow = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Allow once",
    )!;

    await act(async () => allow.click());

    expect(posted("/ask/thread/permission")).toEqual([
      { permissionId: "call", optionId: "allow" },
    ]);

    // Answer text arrives as appends to the entry it belongs to.
    await act(async () =>
      push({ seq: 4, change: { type: "append", id: "a", text: " Twice." } }),
    );
    expect(container.textContent).toContain(
      "Replicas replay the index build. Twice.",
    );

    // A missing change drops the stream; a new one resyncs from a snapshot.
    await act(async () =>
      push({ seq: 6, change: { type: "append", id: "a", text: " Lost." } }),
    );
    await vi.waitFor(() => expect(watches).toBe(2));
    await act(async () =>
      push({
        seq: 6,
        snapshot: state({
          agent: "codex",
          agentName: "Codex",
          status: "idle",
          entries: [{ kind: "agent", id: "a", text: "Resynced." }],
        }),
      }),
    );
    expect(container.textContent).toContain("Resynced.");
    expect(container.textContent).not.toContain("Lost.");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }

  expect(posted("/ask/thread/close")).toEqual(["POST"]);
});

/** What the document's marks report once they place themselves. */
function ReportOutdated({ ids }: { ids: string[] }) {
  const report = useAskHistory()?.reportOutdated;
  const key = ids.join();

  useEffect(() => report?.(new Set(key ? key.split(",") : [])), [report, key]);

  return null;
}

it("lists saved conversations, reopens one, and deletes another once confirmed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = testReviewSession();

  const saved = (id: string, title: string) => ({
    id,
    agent: "claude",
    title,
    selection,
    head: "7fd03b8e2",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:05:00.000Z",
  });

  const fetch = vi
    .spyOn(session, "fetch")
    .mockImplementation(async (endpoint, init) => {
      if (endpoint === "/ask/threads")
        return Response.json({
          threads: [
            saved("first", "Is this safe on replicas?"),
            saved("second", "Why a new index?"),
          ],
        });

      return Response.json({ ok: true }, { status: init?.method ? 200 : 404 });
    });

  let view: unknown;

  function Probe() {
    view = useReviewPanel(({ active }) =>
      active?.kind === "ask" ? active.view : null,
    );

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <ReviewPanelProvider>
            <AskHistoryProvider>
              <AskHistoryList />
              <Probe />
              <ReportOutdated ids={["first"]} />
            </AskHistoryProvider>
          </ReviewPanelProvider>
        </ReviewSessionProvider>,
      ),
    );

    const titles = () =>
      [...container.querySelectorAll("li")].map((row) =>
        row
          .querySelector('button[aria-label^="Delete"]')
          ?.getAttribute("aria-label"),
      );

    expect(titles()).toEqual([
      "Delete “Is this safe on replicas?”",
      "Delete “Why a new index?”",
    ]);

    // The document found the first one's passage changed.
    expect(
      [...container.querySelectorAll("li")].map((row) =>
        Boolean(row.textContent?.includes("Outdated")),
      ),
    ).toEqual([true, false]);

    const deleteButton = () =>
      container.querySelector<HTMLButtonElement>(
        '[aria-label$="Delete “Why a new index?”"]',
      )!;

    const deletes = () =>
      fetch.mock.calls.filter(([endpoint]) => endpoint === "/ask/second");

    // The first click only asks.
    await act(async () => deleteButton().click());
    expect(deletes()).toEqual([]);
    expect(deleteButton().textContent).toBe("Delete");

    await act(async () => deleteButton().click());

    expect(
      fetch.mock.calls
        .filter(([endpoint]) => endpoint === "/ask/second")
        .map(([, init]) => init?.method),
    ).toEqual(["DELETE"]);
    expect(titles()).toEqual(["Delete “Is this safe on replicas?”"]);

    await act(async () =>
      container.querySelector<HTMLButtonElement>("li button")!.click(),
    );

    expect(view).toEqual({
      type: "saved",
      threadId: "first",
      selection,
      agent: "claude",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("shows a refused plan as the answer, and names options the agent offers twice", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = testReviewSession();
  let push!: (update: AskUpdate) => void;

  vi.spyOn(session, "fetch").mockImplementation(async (endpoint) => {
    if (endpoint === "/ask/agents")
      return Response.json({
        agents: [{ id: "claude", name: "Claude Code", available: true }],
      });

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

    return Response.json({ ok: true });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const options = [
    { optionId: "auto", name: "Yes, and use auto mode", kind: "allow_always" },
    {
      optionId: "bypass",
      name: "Yes, bypass permissions",
      kind: "allow_always",
    },
    { optionId: "no", name: "No", kind: "reject_once" },
  ] as const;

  try {
    await act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <AskPanelContent
            selection={selection}
            agent="claude"
            savedThreadId="saved"
          />
        </ReviewSessionProvider>,
      ),
    );

    await act(async () =>
      push({
        seq: 0,
        snapshot: state({
          id: "saved",
          status: "waiting",
          entries: [
            { kind: "user", id: "q", text: "Is this safe?" },
            {
              kind: "tool",
              id: "plan",
              title: "Approve Plan",
              toolKind: "switch_mode",
              status: "failed",
            },
            {
              kind: "agent",
              id: "plan:plan",
              text: "It does, because 0042 opts out.",
            },
            {
              kind: "permission",
              id: "plan",
              title: "Approve Plan",
              toolKind: "switch_mode",
              options: [...options],
              outcome: "no",
              automatic: true,
            },
            // Codex names a command's request only "Run command".
            {
              kind: "permission",
              id: "run",
              title: "Run command",
              toolKind: "execute",
              input: "rg CONCURRENTLY",
              options: [...options],
            },
          ],
        }),
      }),
    );

    expect(container.textContent).toContain("It does, because 0042 opts out.");
    // The refusal is one quiet line among the agent's activity.
    expect(container.textContent).toContain("Refused a change");
    expect(container.textContent).not.toContain("Approve Plan");
    expect(
      container.querySelector('section[aria-label="Permission request"] code')
        ?.textContent,
    ).toBe("$ rg CONCURRENTLY");
    expect(
      [
        ...container.querySelectorAll(
          'section[aria-label="Permission request"] button',
        ),
      ].map((button) => button.textContent),
    ).toEqual(["Yes, and use auto mode", "Yes, bypass permissions", "No"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("keeps the agent through new versions of the review, and says so when the connection is lost", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = testReviewSession();
  let stream!: ReadableStreamDefaultController<Uint8Array>;

  const push = (update: AskUpdate) =>
    stream.enqueue(new TextEncoder().encode(JSON.stringify(update) + "\n"));

  const fetch = vi
    .spyOn(session, "fetch")
    .mockImplementation(async (endpoint) => {
      if (endpoint === "/ask/agents")
        return Response.json({
          agents: [{ id: "claude", name: "Claude Code", available: true }],
        });

      if (endpoint === "/ask/saved/open")
        return Response.json({ threadId: "saved" });

      if (endpoint === "/ask/saved/watch")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
          }),
        );

      return Response.json({ ok: true });
    });

  const calls = (endpoint: string) =>
    fetch.mock.calls.filter(([called]) => called === endpoint).length;

  let view: unknown;

  function Probe() {
    view = useReviewPanel(({ active }) =>
      active?.kind === "ask" ? active.view : null,
    );

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  // Each new version of the review hands the canvas a new session object.
  const render = (version: typeof session) =>
    root.render(
      <ReviewSessionProvider session={version}>
        <ReviewPanelProvider>
          <AskPanelContent
            selection={selection}
            agent="claude"
            savedThreadId="saved"
          />
          <Probe />
        </ReviewPanelProvider>
      </ReviewSessionProvider>,
    );

  try {
    await act(async () => render(session));
    await act(async () =>
      push({
        seq: 0,
        snapshot: state({
          id: "saved",
          entries: [{ kind: "agent", id: "a", text: "Checking" }],
        }),
      }),
    );
    expect(working(container)).not.toBeNull();

    // The agent edited the review; the answer carries on.
    await act(async () => render({ ...session }));
    expect(calls("/ask/saved/close")).toBe(0);
    expect(calls("/ask/saved/open")).toBe(1);
    expect(calls("/ask/saved/watch")).toBe(1);

    await act(async () => stream.close());
    await act(async () => new Promise((resolve) => setTimeout(resolve)));

    // Lost, it stops looking busy and offers the way back.
    expect(container.textContent).toContain(
      "Whiteboard lost its connection to Claude Code.",
    );
    expect(working(container)).toBeNull();
    expect(buttonNamed(container, "Stop")).toBeNull();

    await act(async () => buttonNamed(container, "Reconnect")!.click());
    expect(view).toMatchObject({ type: "saved", threadId: "saved" });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }

  // The thread was already gone, so nothing asked the server to close it.
  expect(calls("/ask/saved/close")).toBe(0);
});

it("asks with the model and effort the reviewer picks, and switches them between answers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = testReviewSession();
  let push!: (update: AskUpdate) => void;

  const choices = {
    model: {
      current: "default",
      options: [
        { value: "default", name: "Default", description: "Opus 5" },
        { value: "sonnet", name: "Sonnet" },
      ],
    },
    effort: {
      current: "medium",
      options: [
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    },
  };

  const fetch = vi
    .spyOn(session, "fetch")
    .mockImplementation(async (endpoint) => {
      if (endpoint === "/ask/agents")
        return Response.json({
          agents: [{ id: "codex", name: "Codex", available: true }],
        });

      if (endpoint === "/ask/agents/codex/choices")
        return Response.json({ choices });

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

      return Response.json({ ok: true });
    });

  const bodies = (endpoint: string) =>
    fetch.mock.calls
      .filter(([called]) => called === endpoint)
      .map(([, init]) => JSON.parse(String(init?.body)));

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const pick = async (label: string, name: string) => {
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(`[aria-label^="${label}:"]`)!
        .click(),
    );
    await act(async () =>
      [
        ...container.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemradio"]',
        ),
      ]
        .find((item) => item.textContent?.includes(name))!
        .click(),
    );
  };

  try {
    await act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <AskPanelContent selection={selection} agent="codex" />
        </ReviewSessionProvider>,
      ),
    );

    // What the agent offers, before anything is asked of it.
    expect(
      [
        ...container.querySelectorAll(
          'button[aria-haspopup="menu"][aria-label]',
        ),
      ].map((picker) => picker.textContent),
    ).toEqual(["Default", "Medium"]);
    await pick("Model", "Sonnet");
    await pick("Effort", "High");

    const textarea = container.querySelector("textarea")!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "Is this safe?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(bodies("/ask")[0]).toMatchObject({
      picks: { model: "sonnet", effort: "high" },
    });

    await act(async () =>
      push({
        seq: 0,
        snapshot: state({
          agent: "codex",
          agentName: "Codex",
          status: "idle",
          choices: {
            model: { ...choices.model, current: "sonnet" },
            effort: { ...choices.effort, current: "high" },
          },
        }),
      }),
    );
    await pick("Effort", "Medium");
    expect(bodies("/ask/thread/choice")).toEqual([
      { kind: "effort", value: "medium" },
    ]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("says how to sign a signed-out agent back in, and tries again once it is", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = testReviewSession();
  let push!: (update: AskUpdate) => void;

  const watch = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        push = (update) =>
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify(update) + "\n"),
          );
      },
    });

  const fetch = vi
    .spyOn(session, "fetch")
    .mockImplementation(async (endpoint) =>
      endpoint === "/ask/saved/watch"
        ? new Response(watch())
        : Response.json({ ok: true }),
    );

  const retries = () =>
    fetch.mock.calls.filter(([called]) => called === "/ask/saved/retry").length;

  const asked = {
    kind: "user" as const,
    id: "u",
    text: "Is this safe?",
    at: Date.now(),
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <AskPanelContent
            selection={selection}
            agent="claude"
            savedThreadId="saved"
          />
        </ReviewSessionProvider>,
      ),
    );
    await act(async () =>
      push({
        seq: 0,
        snapshot: state({
          id: "saved",
          status: "failed",
          error: "Claude Code is signed out.",
          signIn: "claude auth login",
          entries: [asked],
        }),
      }),
    );

    const signIn = container.querySelector('[aria-label="Sign in"]');

    expect(signIn?.textContent).toContain("$ claude auth login");
    expect(signIn?.textContent).toContain("Claude Code is signed out.");

    await act(async () => buttonNamed(container, "Try again")!.click());
    expect(retries()).toBe(1);

    // Starting again, it has nothing to ask of the reviewer.
    await act(async () =>
      push({
        seq: 1,
        change: { type: "set", status: "starting", error: null, signIn: null },
      }),
    );
    expect(container.querySelector('[aria-label="Sign in"]')).toBeNull();
    expect(buttonNamed(container, "Try again")).toBeNull();

    // Any other failure can be tried again too.
    await act(async () =>
      push({
        seq: 2,
        change: { type: "set", status: "failed", error: "The agent exited." },
      }),
    );
    expect(container.textContent).toContain("The agent exited.");
    await act(async () => buttonNamed(container, "Try again")!.click());
    expect(retries()).toBe(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("offers a new chat when a conversation cannot be reopened: one lost before it was saved, or one the server no longer has", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = testReviewSession();
  let stream!: ReadableStreamDefaultController<Uint8Array>;

  vi.spyOn(session, "fetch").mockImplementation(async (endpoint, init) => {
    if (endpoint === "/ask/agents")
      return Response.json({
        agents: [{ id: "claude", name: "Claude Code", available: true }],
      });

    if (endpoint === "/ask/threads") return Response.json({ threads: [] });

    if (endpoint === "/ask") return Response.json({ threadId: "thread" });

    if (endpoint === "/ask/thread/watch")
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
          },
        }),
      );

    if (endpoint === "/ask/gone/open")
      return Response.json(
        { error: "This conversation was not found." },
        { status: 404 },
      );

    return Response.json({ ok: true }, { status: init?.method ? 200 : 404 });
  });

  let view: unknown;

  function Probe() {
    view = useReviewPanel(({ active }) =>
      active?.kind === "ask" ? active.view : null,
    );

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const render = (savedThreadId?: string) =>
    root.render(
      <ReviewSessionProvider session={session}>
        <ReviewPanelProvider>
          <AskHistoryProvider>
            <AskPanelContent
              key={savedThreadId}
              selection={selection}
              agent="claude"
              savedThreadId={savedThreadId}
            />
            <Probe />
          </AskHistoryProvider>
        </ReviewPanelProvider>
      </ReviewSessionProvider>,
    );

  try {
    await act(async () => render());

    const textarea = container.querySelector("textarea")!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "Is this safe?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );

    const push = (update: AskUpdate) =>
      stream.enqueue(new TextEncoder().encode(JSON.stringify(update) + "\n"));

    // The agent never started a session, so Whiteboard saved nothing.
    await act(async () =>
      push({
        seq: 0,
        snapshot: state({
          status: "starting",
          entries: [{ kind: "user", id: "q", text: "Is this safe?" }],
        }),
      }),
    );
    await act(async () => stream.close());
    await act(async () => new Promise((resolve) => setTimeout(resolve)));

    expect(buttonNamed(container, "Reconnect")).toBeNull();
    await act(async () => buttonNamed(container, "Start a new chat")!.click());
    expect(view).toMatchObject({ type: "new", selection, agent: "claude" });

    // A saved conversation the server no longer has.
    await act(async () => render("gone"));
    await act(async () => new Promise((resolve) => setTimeout(resolve)));

    expect(container.textContent).toContain("This conversation was not found.");
    await act(async () => buttonNamed(container, "Start a new chat")!.click());
    expect(view).toMatchObject({ type: "new", selection, agent: "claude" });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("stops a conversation while it reopens, and takes no answer to a permission once it has stopped", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const session = testReviewSession();
  let stream!: ReadableStreamDefaultController<Uint8Array>;

  const fetch = vi
    .spyOn(session, "fetch")
    .mockImplementation(async (endpoint, init) => {
      if (endpoint === "/ask/agents")
        return Response.json({
          agents: [{ id: "claude", name: "Claude Code", available: true }],
        });

      if (endpoint === "/ask/saved/open")
        return Response.json({ threadId: "saved" });

      if (endpoint === "/ask/saved/watch")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
          }),
        );

      return Response.json({ ok: true }, { status: init?.method ? 200 : 404 });
    });

  const push = (update: AskUpdate) =>
    stream.enqueue(new TextEncoder().encode(JSON.stringify(update) + "\n"));

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const saved = [
    { kind: "user" as const, id: "q", text: "Is this safe?" },
    { kind: "agent" as const, id: "a", text: "It is." },
  ];

  try {
    await act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <AskPanelContent
            selection={selection}
            agent="claude"
            savedThreadId="saved"
          />
        </ReviewSessionProvider>,
      ),
    );
    await act(async () =>
      push({
        seq: 0,
        snapshot: state({ id: "saved", status: "starting", entries: saved }),
      }),
    );

    // Loading the conversation can be stopped like an answer.
    await act(async () => buttonNamed(container, "Stop")!.click());
    expect(
      fetch.mock.calls.filter(([called]) => called === "/ask/saved/cancel"),
    ).toHaveLength(1);

    await act(async () =>
      push({
        seq: 1,
        snapshot: state({
          id: "saved",
          status: "failed",
          error: "Claude Code stopped.",
          entries: [
            ...saved,
            {
              kind: "permission",
              id: "call",
              title: "Run npm test",
              toolKind: "execute",
              options: [
                { optionId: "allow", name: "Allow once", kind: "allow_once" },
                { optionId: "deny", name: "Deny", kind: "reject_once" },
              ],
            },
          ],
        }),
      }),
    );

    const options = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'section[aria-label="Permission request"] button',
      ),
    ];

    expect(options).toHaveLength(2);
    expect(options.every((option) => option.disabled)).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
