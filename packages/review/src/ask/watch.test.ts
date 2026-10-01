import type { AskThreadState, AskUpdate } from "@review/ask/thread-state.js";
import { watchAskThread } from "@review/ask/watch.js";
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
    .map((line) => JSON.parse(line) as AskUpdate);
}

it("sends a snapshot, then each change in order", async () => {
  const source = thread();
  const response = watchAskThread(source);

  source.append("It ");
  source.append("does.");

  expect(await lines(response, 3)).toEqual([
    { seq: 0, snapshot: state },
    { seq: 1, change: { type: "append", id: "a", text: "It " } },
    { seq: 2, change: { type: "append", id: "a", text: "does." } },
  ]);
});

it("replaces the backlog of a reader that falls behind with one snapshot", async () => {
  const source = thread();
  const response = watchAskThread(source, 3);

  // Nothing reads while five changes arrive: more than the backlog holds.
  for (const text of ["a", "b", "c", "d", "e"]) source.append(text);

  // The stream already held the first snapshot. The fourth change overflows
  // the backlog, which becomes a snapshot; the fifth follows it.
  expect(await lines(response, 3)).toEqual([
    { seq: 0, snapshot: state },
    { seq: 4, snapshot: state },
    { seq: 5, change: { type: "append", id: "a", text: "e" } },
  ]);
});

it("ends once the thread closes, after what it already sent", async () => {
  const source = thread();
  const response = watchAskThread(source);

  source.append("Stopped.");
  source.close();
  // A change after closing is not the thread's any more.
  source.append("Late.");

  expect(
    (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  ).toEqual([
    { seq: 0, snapshot: state },
    { seq: 1, change: { type: "append", id: "a", text: "Stopped." } },
  ]);
});
