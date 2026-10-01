// @vitest-environment jsdom
import type { AskEntry, AskThreadState } from "@review/ask/thread-state";
import { type ReactNode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { AskAgentTurn, AskWorking } from "./ask-turn";

type AgentEntry = Exclude<AskEntry, { kind: "user" }>;

const thread = (entries: AskEntry[]): AskThreadState => ({
  id: "thread",
  agent: "claude",
  agentName: "Claude Code",
  status: "running",
  readOnly: true,
  bypass: false,
  head: "7fd03b8e2",
  cwd: "/checkouts/payments",
  selection: { title: "Paragraph 3" },
  entries,
});

const grep: AgentEntry = {
  kind: "tool",
  id: "grep",
  title: "git grep -n CONCURRENTLY",
  toolKind: "execute",
  status: "completed",
  input: "git grep -n CONCURRENTLY",
  summary: "Find concurrent indexes",
  output: "db/0042.sql:1:CREATE INDEX CONCURRENTLY",
};

const read: AgentEntry = {
  kind: "tool",
  id: "read",
  title: "Read /checkouts/payments/db/migrate/runner.ts",
  toolKind: "read",
  status: "completed",
};

const log: AgentEntry = {
  kind: "tool",
  id: "log",
  title: "git log -1",
  toolKind: "execute",
  status: "in_progress",
  input: "git log -1",
};

async function render(node: ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => root.render(node));

  return {
    container,
    click: (selector: string) =>
      act(async () => container.querySelector<HTMLElement>(selector)!.click()),
    root,
    unmount: () => act(async () => root.unmount()),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("collapses the agent's tool calls to what they add up to, and opens each to what it ran", async () => {
  const entries: AgentEntry[] = [
    grep,
    read,
    log,
    { kind: "agent", id: "a", text: "It does." },
  ];

  const view = await render(
    <AskAgentTurn
      thread={thread(entries)}
      entries={entries}
      renderPermission={() => null}
    />,
  );

  const summary = view.container.querySelector("button[aria-expanded]")!;

  expect(summary.textContent).toBe("Ran 2 commands, read a file");
  expect(view.container.querySelector("li")).toBeNull();
  expect(view.container.textContent).toContain("It does.");

  await view.click("button[aria-expanded]");

  const labels = [...view.container.querySelectorAll("li [title]")].map(
    (label) => label.textContent,
  );

  // The agent's note on why, else what it ran, relative to the checkout.
  expect(labels).toEqual([
    "Find concurrent indexes",
    "Read db/migrate/runner.ts",
    "git log -1",
  ]);

  await view.click("li button[aria-expanded]");

  // What it ran, then what came back.
  expect(
    [...view.container.querySelectorAll("li pre")].map(
      (block) => block.textContent,
    ),
  ).toEqual([
    "$ git grep -n CONCURRENTLY",
    "db/0042.sql:1:CREATE INDEX CONCURRENTLY",
  ]);
  await view.unmount();
});

it("reads a command the reviewer denied as the denial, not as run", async () => {
  const options = [
    { optionId: "yes", name: "Yes", kind: "allow_once" as const },
    { optionId: "no", name: "No", kind: "reject_once" as const },
  ];

  const entries: AgentEntry[] = [
    {
      kind: "tool",
      id: "touch",
      title: "Run command",
      toolKind: "execute",
      status: "failed",
      input: "touch scratch.txt",
    },
    {
      kind: "permission",
      id: "touch",
      title: "Run command",
      toolKind: "execute",
      input: "touch scratch.txt",
      options,
      outcome: "no",
    },
    { kind: "agent", id: "a", text: "Left it alone." },
  ];

  const view = await render(
    <AskAgentTurn
      thread={thread(entries)}
      entries={entries}
      renderPermission={() => null}
    />,
  );

  expect(
    view.container.querySelector("button[aria-expanded]")?.textContent,
  ).toBe("You denied a request");
  await view.click("button[aria-expanded]");
  expect(view.container.querySelector("li [title]")?.textContent).toBe(
    "Denied touch scratch.txt",
  );
  await view.unmount();
});

it("reads Codex's shell-wrapped commands and Whiteboard's own tools plainly", async () => {
  const run = (id: string, input: string): AgentEntry => ({
    kind: "tool",
    id,
    title: input,
    toolKind: "execute",
    status: "completed",
    input,
  });

  const entries: AgentEntry[] = [
    {
      kind: "tool",
      id: "get",
      title: "mcp.whiteboard.session_get",
      toolKind: "other",
      status: "completed",
    },
    run("sed", `/bin/zsh -lc "sed -n '65,145p' src/extension.ts"`),
    run("joined", "/bin/zsh -lc rg -n setMode"),
    // Two quoted words, not one wrapped command: left as it is.
    run("two", "bash -lc 'a' && 'b'"),
    { kind: "agent", id: "a", text: "It sets the mode." },
  ];

  const view = await render(
    <AskAgentTurn
      thread={thread(entries)}
      entries={entries}
      renderPermission={() => null}
    />,
  );

  expect(
    view.container.querySelector("button[aria-expanded]")?.textContent,
  ).toBe("Read the review, ran 3 commands");
  await view.click("button[aria-expanded]");
  expect(
    [...view.container.querySelectorAll("li [title]")].map(
      (label) => label.textContent,
    ),
  ).toEqual([
    "Read the review",
    "sed -n '65,145p' src/extension.ts",
    "rg -n setMode",
    "bash -lc 'a' && 'b'",
  ]);
  await view.unmount();
});

it("reads as writing while the answer streams in, and thinking again once it pauses", async () => {
  vi.useFakeTimers();

  const answer = (text: string) =>
    thread([{ kind: "agent", id: "a", text }] satisfies AgentEntry[]);

  const view = await render(<AskWorking thread={answer("It")} />);

  // Text there when it started is not text arriving.
  expect(view.container.textContent).toContain("Thinking…");

  await act(async () =>
    view.root.render(<AskWorking thread={answer("It is")} />),
  );
  expect(view.container.textContent).toContain("Writing…");

  await act(async () => vi.advanceTimersByTime(1_000));
  expect(view.container.textContent).toContain("Thinking…");
  await view.unmount();
  vi.useRealTimers();
});

it("shows an answer still arriving without its half-written syntax", async () => {
  const entries: AgentEntry[] = [
    {
      kind: "agent",
      id: "a",
      text: "It is **safe: see [the runner](https://exa",
    },
  ];

  const view = await render(
    <AskAgentTurn
      thread={thread(entries)}
      entries={entries}
      renderPermission={() => null}
    />,
  );

  expect(view.container.textContent).toContain("It is safe: see the runner");
  expect(view.container.querySelector("strong")?.textContent).toBe(
    "safe: see the runner",
  );
  await view.unmount();
});
