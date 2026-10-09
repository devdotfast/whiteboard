import { expect, test } from "bun:test";
import { requestOpen, receiveOpen } from "./bridge";
const request = { directory: process.cwd(), sessionID: "session-test", args: ["HEAD~1", "--", "a file.ts"] };

test("a matching TUI acknowledges the actual open and receives unquoted arguments", async () => {
  let received: unknown;
  const result = await requestOpen(async command => {
    void receiveOpen(command, process.cwd(), () => request.sessionID, async value => { received = value.args; return "Opened 2 files"; }, new AbortController().signal);
  }, request, new AbortController().signal);
  expect(received).toEqual(request.args);
  expect(result).toBe("Opened 2 files");
});

test("a hidden session cannot acknowledge another session's tool", async () => {
  let opens = 0;
  await expect(requestOpen(async command => {
    await receiveOpen(command, process.cwd(), () => "another-session", async () => { opens++; return "wrong"; }, new AbortController().signal);
  }, request, new AbortController().signal, 30)).rejects.toThrow("No matching");
  expect(opens).toBe(0);
});

test("producer failures reach the model and only one attached TUI claims a request", async () => {
  let opens = 0;
  await expect(requestOpen(async command => {
    for (let i = 0; i < 2; i++) void receiveOpen(command, process.cwd(), () => request.sessionID, async () => {
      opens++; throw new Error("bad revision");
    }, new AbortController().signal);
  }, request, new AbortController().signal)).rejects.toThrow("bad revision");
  expect(opens).toBe(1);
});

test("model cancellation interrupts an in-progress terminal open", async () => {
  const controller = new AbortController();
  let cancelled!: Promise<void>;
  await expect(requestOpen(async command => {
    void receiveOpen(command, process.cwd(), () => request.sessionID, async (_request, signal) => {
      cancelled = new Promise(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      controller.abort();
      await cancelled;
      throw new Error("cancelled");
    }, new AbortController().signal);
  }, request, controller.signal)).rejects.toThrow("cancelled");
  await cancelled;
});
