import { describe, expect, it, vi } from "vitest";

import { GlobalReviewDesktopVerbRelay } from "./global-verb-relay";

const openVerb = {
  name: "openApiReview",
  args: { reviewId: "8f2c1e4a-3b5d-4c6e-9f70-1a2b3c4d5e6f", title: "Review" },
};

describe("global Review Desktop verb relay", () => {
  it("attaches one transport-independent writer and correlates results", async () => {
    const relay = new GlobalReviewDesktopVerbRelay();
    const first = createWriter();

    expect(relay.attached).toBe(false);
    expect(relay.attach(first.writer)).toBe(true);
    expect(relay.attached).toBe(true);

    const result = relay.dispatch({
      name: "focusWindow",
      args: {},
    });

    await vi.waitFor(() => expect(first.frames).toHaveLength(1));

    expect(
      relay.acceptResult({
        id: "unknown-request",
        response: { ok: true },
      }),
    ).toBe(false);
    expect(
      relay.acceptResult({
        id: frameId(first),
        response: { ok: true, result: { focused: true } },
      }),
    ).toBe(true);
    await expect(result).resolves.toEqual({
      ok: true,
      result: { focused: true },
    });

    first.abort.abort();
    expect(relay.attached).toBe(false);
    await expect(
      relay.dispatch({ name: "focusWindow", args: {} }),
    ).resolves.toEqual({
      ok: false,
      error: "No Whiteboard Desktop is attached.",
    });
  });

  it("sends a verb to every attached client", async () => {
    const relay = new GlobalReviewDesktopVerbRelay();
    const clients = [createWriter(), createWriter()];

    for (const client of clients)
      expect(relay.attach(client.writer)).toBe(true);

    void relay.dispatch(openVerb);

    await vi.waitFor(() =>
      clients.forEach((client) => expect(client.frames).toHaveLength(1)),
    );

    for (const client of clients)
      expect(JSON.parse(client.frames[0].slice(6))).toMatchObject({
        event: "desktop-verb",
        request: openVerb,
      });

    // Each client answers with its own id, so a result names its client.
    expect(frameId(clients[0])).not.toBe(frameId(clients[1]));
  });

  it("sends to every client when the first one's write throws", async () => {
    const relay = new GlobalReviewDesktopVerbRelay();
    const broken = createWriter();
    const working = createWriter();

    broken.writer.write = () => {
      throw new Error("closed");
    };

    relay.attach(broken.writer);
    relay.attach(working.writer);

    const result = settled(relay.dispatch(openVerb));

    await vi.waitFor(() => expect(working.frames).toHaveLength(1));
    await Promise.resolve();
    expect(result.done).toBe(false);
    relay.acceptResult({ id: frameId(working), response: { ok: true } });
    await expect(result.promise).resolves.toEqual({ ok: true });
  });

  it("resolves with the first success without waiting for a silent client, and ignores later answers", async () => {
    vi.useFakeTimers();

    try {
      const relay = new GlobalReviewDesktopVerbRelay({ timeoutMs: 45_000 });
      const [answering, silent] = attachAll(relay, 2);

      const result = settled(relay.dispatch(openVerb));

      await vi.waitFor(() => expect(answering.frames).toHaveLength(1));
      expect(silent.frames).toHaveLength(1);

      const id = frameId(answering);

      expect(
        relay.acceptResult({
          id,
          response: { ok: true, result: { softwareMapEnabled: false } },
        }),
      ).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(result.value).toEqual({
        ok: true,
        result: { softwareMapEnabled: false },
      });

      for (const late of [id, frameId(silent)])
        expect(
          relay.acceptResult({
            id: late,
            response: { ok: false, error: "late" },
          }),
        ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves with a success that follows a failure", async () => {
    const relay = new GlobalReviewDesktopVerbRelay();
    const [first, second] = attachAll(relay, 2);

    const result = relay.dispatch(openVerb);

    await vi.waitFor(() => expect(second.frames).toHaveLength(1));

    expect(
      relay.acceptResult({
        id: frameId(first),
        response: { ok: false, error: "first" },
      }),
    ).toBe(true);
    expect(
      relay.acceptResult({ id: frameId(second), response: { ok: true } }),
    ).toBe(true);
    await expect(result).resolves.toEqual({ ok: true });
  });

  it("resolves with the last failure when every client fails", async () => {
    const relay = new GlobalReviewDesktopVerbRelay();
    const [first, second] = attachAll(relay, 2);

    const result = relay.dispatch(openVerb);

    await vi.waitFor(() => expect(second.frames).toHaveLength(1));
    relay.acceptResult({
      id: frameId(first),
      response: { ok: false, error: "first" },
    });
    relay.acceptResult({
      id: frameId(second),
      response: { ok: false, error: "second" },
    });
    await expect(result).resolves.toEqual({ ok: false, error: "second" });
  });

  it("waits for a silent client after another fails and detaches", async () => {
    const relay = new GlobalReviewDesktopVerbRelay();
    const [failing, silent] = attachAll(relay, 2);

    const result = settled(relay.dispatch(openVerb));

    await vi.waitFor(() => expect(silent.frames).toHaveLength(1));
    relay.acceptResult({
      id: frameId(failing),
      response: { ok: false, error: "A failed" },
    });
    failing.abort.abort();
    await Promise.resolve();
    expect(result.done).toBe(false);
    expect(
      relay.acceptResult({ id: frameId(silent), response: { ok: true } }),
    ).toBe(true);
    await expect(result.promise).resolves.toEqual({ ok: true });
  });

  it("counts one answer per client", async () => {
    const relay = new GlobalReviewDesktopVerbRelay();
    const [failing, silent] = attachAll(relay, 2);

    const result = settled(relay.dispatch(openVerb));

    await vi.waitFor(() => expect(silent.frames).toHaveLength(1));

    const id = frameId(failing);

    expect(
      relay.acceptResult({ id, response: { ok: false, error: "A1" } }),
    ).toBe(true);
    expect(
      relay.acceptResult({ id, response: { ok: false, error: "A2" } }),
    ).toBe(false);
    await Promise.resolve();
    expect(result.done).toBe(false);
    relay.acceptResult({ id: frameId(silent), response: { ok: true } });
    await expect(result.promise).resolves.toEqual({ ok: true });
  });

  it("keeps a verb in flight when one client detaches, and the other's answer resolves it", async () => {
    const relay = new GlobalReviewDesktopVerbRelay();
    const [leaving, staying] = attachAll(relay, 2);

    const result = settled(relay.dispatch(openVerb));

    await vi.waitFor(() => expect(staying.frames).toHaveLength(1));
    leaving.abort.abort();
    await Promise.resolve();

    expect(relay.attached).toBe(true);
    expect(result.done).toBe(false);
    expect(
      relay.acceptResult({ id: frameId(staying), response: { ok: true } }),
    ).toBe(true);
    await expect(result.promise).resolves.toEqual({ ok: true });
  });

  it("resolves at once when no client that was sent the verb is left to answer", async () => {
    const relay = new GlobalReviewDesktopVerbRelay();
    const [failing, leaving] = attachAll(relay, 2);

    const failed = relay.dispatch(openVerb);

    await vi.waitFor(() => expect(failing.frames).toHaveLength(1));
    relay.acceptResult({
      id: frameId(failing),
      response: { ok: false, error: "failed" },
    });
    leaving.abort.abort();
    await expect(failed).resolves.toEqual({ ok: false, error: "failed" });

    const unanswered = relay.dispatch(openVerb);

    await vi.waitFor(() => expect(failing.frames).toHaveLength(2));
    // A client that attaches later was not sent the verb.
    relay.attach(createWriter().writer);
    failing.abort.abort();
    await expect(unanswered).resolves.toEqual({
      ok: false,
      error: "No Whiteboard Desktop is attached.",
    });
  });

  it("detaches only a client whose stream fails", async () => {
    const relay = new GlobalReviewDesktopVerbRelay();
    const broken = createWriter();
    const working = createWriter();

    broken.writer.write = () => Promise.reject(new Error("closed"));
    relay.attach(broken.writer);
    relay.attach(working.writer);

    const result = relay.dispatch(openVerb);

    await vi.waitFor(() => expect(working.frames).toHaveLength(1));
    await Promise.resolve();
    expect(relay.attached).toBe(true);
    // Only the working client is left to answer, so its failure is final.
    relay.acceptResult({
      id: frameId(working),
      response: { ok: false, error: "working failed" },
    });
    await expect(result).resolves.toEqual({
      ok: false,
      error: "working failed",
    });
  });

  it("refuses a client beyond its limit, 16 unless told otherwise", () => {
    const relay = new GlobalReviewDesktopVerbRelay();

    attachAll(relay, 16);
    expect(relay.attach(createWriter().writer)).toBe(false);

    const single = new GlobalReviewDesktopVerbRelay({ maxClients: 1 });
    const first = createWriter();

    expect(single.attach(first.writer)).toBe(true);
    expect(single.attach(createWriter().writer)).toBe(false);
    first.abort.abort();
    expect(single.attach(createWriter().writer)).toBe(true);
  });

  it("resolves pending verbs on timeout, disconnect, and close", async () => {
    vi.useFakeTimers();

    try {
      const timeoutRelay = new GlobalReviewDesktopVerbRelay({ timeoutMs: 25 });
      const timeoutWriter = createWriter();
      timeoutRelay.attach(timeoutWriter.writer);

      const timedOut = timeoutRelay.dispatch({
        name: "focusWindow",
        args: {},
      });

      await vi.advanceTimersByTimeAsync(25);
      await expect(timedOut).resolves.toEqual({
        ok: false,
        error: "Whiteboard Desktop verb timed out.",
      });

      const [failing] = attachAll(timeoutRelay, 1);

      const failedThenTimedOut = timeoutRelay.dispatch({
        name: "focusCanvas",
        args: {},
      });

      timeoutRelay.acceptResult({
        id: frameId(failing),
        response: { ok: false, error: "failed" },
      });
      await vi.advanceTimersByTimeAsync(25);
      await expect(failedThenTimedOut).resolves.toEqual({
        ok: false,
        error: "failed",
      });

      const disconnectRelay = new GlobalReviewDesktopVerbRelay();
      const disconnectWriter = createWriter();
      disconnectRelay.attach(disconnectWriter.writer);

      const disconnected = disconnectRelay.dispatch({
        name: "focusWindow",
        args: {},
      });

      disconnectWriter.abort.abort();
      await expect(disconnected).resolves.toEqual({
        ok: false,
        error: "No Whiteboard Desktop is attached.",
      });

      const closedRelay = new GlobalReviewDesktopVerbRelay();
      const closedWriters = attachAll(closedRelay, 3);

      closedWriters[0].close.mockImplementation(() => {
        throw new Error("already closed");
      });

      const closed = closedRelay.dispatch({
        name: "focusWindow",
        args: {},
      });

      closedRelay.close();

      for (const writer of closedWriters)
        expect(writer.close).toHaveBeenCalledOnce();
      expect(closedRelay.attached).toBe(false);
      await expect(closed).resolves.toEqual({
        ok: false,
        error: "Whiteboard Desktop relay closed.",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

function attachAll(relay: GlobalReviewDesktopVerbRelay, count: number) {
  return Array.from({ length: count }, () => {
    const client = createWriter();

    expect(relay.attach(client.writer)).toBe(true);

    return client;
  });
}

function frameId(client: { frames: string[] }): string {
  return (JSON.parse(client.frames.at(-1)!.slice(6)) as { id: string }).id;
}

function settled<T>(promise: Promise<T>) {
  let done = false;
  let value: T | undefined;

  void promise.then((result) => {
    done = true;
    value = result;
  });

  return {
    promise,
    get done() {
      return done;
    },
    get value() {
      return value;
    },
  };
}

function createWriter() {
  const abort = new AbortController();
  const close = vi.fn<() => void>();
  const frames: string[] = [];

  return {
    abort,
    close,
    frames,
    writer: {
      signal: abort.signal,
      write(frame: string): void | Promise<void> {
        frames.push(frame);
      },
      close,
    },
  };
}
