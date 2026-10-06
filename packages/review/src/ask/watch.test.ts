import type {
  AskThreadState,
  AskUpdate,
  AskWatchLine,
} from "@review/ask/thread-state.js";
import { watchAskThreads } from "@review/ask/watch.js";
import { expect, it } from "vitest";

const state: AskThreadState = {
  id: "thread",
  agent: "claude",
  agentName: "Claude Code",
  status: "running",
  readOnly: true,
  bypass: false,
  head: "abc123",
  cwd: "/checkout",
  selection: { title: "Paragraph 3" },
  entries: [{ kind: "agent", id: "a", text: "" }],
};

/** A thread whose changes the test sends by hand. */
function thread() {
  const listeners = new Set<(update: AskUpdate) => void>();
  const closers = new Set<() => void>();
  let seq = 0;

  return {
    snapshot: (): AskUpdate => ({ seq, snapshot: state }),
    subscribe(listener: (update: AskUpdate) => void) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    onClose(closed: () => void) {
      closers.add(closed);

      return () => closers.delete(closed);
    },
    close() {
      for (const closed of closers) closed();
    },
    append(text: string) {
      seq += 1;

      for (const listener of listeners)
        listener({ seq, change: { type: "append", id: "a", text } });
    },
  };
}

async function lines(response: Response, count: number) {
  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();

  let text = "";

  while (text.split("\n").length <= count) {
    const { value } = await reader.read();

    text += value;
  }

  await reader.cancel();

  return text
    .split("\n")
    .slice(0, count)
    .map((line) => JSON.parse(line) as AskWatchLine);
}

async function all(response: Response) {
  return (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as AskWatchLine);
}

it("sends a snapshot, then each change in order", async () => {
  const source = thread();
  const response = watchAskThreads(new Map([["a", source]]));

  source.append("It ");
  source.append("does.");

  expect(await lines(response, 3)).toEqual([
    { threadId: "a", update: { seq: 0, snapshot: state } },
    {
      threadId: "a",
      update: { seq: 1, change: { type: "append", id: "a", text: "It " } },
    },
    {
      threadId: "a",
      update: { seq: 2, change: { type: "append", id: "a", text: "does." } },
    },
  ]);
});

it("carries several threads on one stream, taking turns", async () => {
  const first = thread();
  const second = thread();

  const response = watchAskThreads(
    new Map([
      ["first", first],
      ["second", second],
    ]),
  );

  first.append("One.");
  second.append("Two.");
  first.close();
  second.close();

  expect(await all(response)).toEqual([
    { threadId: "first", update: { seq: 0, snapshot: state } },
    { threadId: "second", update: { seq: 0, snapshot: state } },
    {
      threadId: "first",
      update: { seq: 1, change: { type: "append", id: "a", text: "One." } },
    },
    {
      threadId: "second",
      update: { seq: 1, change: { type: "append", id: "a", text: "Two." } },
    },
    { threadId: "first", ended: true },
    { threadId: "second", ended: true },
  ]);
});

it("says at once that a thread which isn't running has ended", async () => {
  const response = watchAskThreads(new Map([["gone", undefined]]));

  expect(await all(response)).toEqual([{ threadId: "gone", ended: true }]);
});

it("replaces the backlog of a reader that falls behind with one snapshot", async () => {
  const source = thread();
  const response = watchAskThreads(new Map([["a", source]]), 3);

  // Nothing reads while five changes arrive: more than the backlog holds.
  for (const text of ["a", "b", "c", "d", "e"]) source.append(text);

  // The stream already held the first snapshot. The fourth change overflows
  // the backlog, which becomes a snapshot; the fifth follows it.
  expect(await lines(response, 3)).toEqual([
    { threadId: "a", update: { seq: 0, snapshot: state } },
    { threadId: "a", update: { seq: 4, snapshot: state } },
    {
      threadId: "a",
      update: { seq: 5, change: { type: "append", id: "a", text: "e" } },
    },
  ]);
});

it("ends a thread once it closes, after what it already sent", async () => {
  const source = thread();
  const response = watchAskThreads(new Map([["a", source]]));

  source.append("Stopped.");
  source.close();
  // A change after closing is not the thread's any more.
  source.append("Late.");

  expect(await all(response)).toEqual([
    { threadId: "a", update: { seq: 0, snapshot: state } },
    {
      threadId: "a",
      update: { seq: 1, change: { type: "append", id: "a", text: "Stopped." } },
    },
    { threadId: "a", ended: true },
  ]);
});
