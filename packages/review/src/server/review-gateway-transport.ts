import type http from "node:http";

import {
  FIRST_BYTE_TIMEOUT_MS,
  FIRST_RETRY_MS,
  type GatewayHosts,
  type GatewayRemote,
  MAX_RETRY_MS,
  NO_ANSWER,
  jitter,
  remoteHeaders,
  send,
} from "./review-gateway-hosts.js";

/** A stream that stayed up this long starts its backoff again. */
const STEADY_MS = 10_000;

const MAX_LINE_CHARS = 64 * 1024 * 1024;

export const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };

    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });

/** Calls `line` with each newline-terminated line of a body. */
export async function readLines(
  body: AsyncIterable<Uint8Array>,
  line: (text: string) => void,
) {
  const decoder = new TextDecoder();
  let pending = "";

  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    let end: number;

    while ((end = pending.indexOf("\n")) !== -1) {
      line(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }

    if (pending.length > MAX_LINE_CHARS) throw new Error("A line is too long.");
  }
}

/** A web stream's chunks, cancelled when `signal` aborts. */
export function chunks(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);

  return {
    async *[Symbol.asyncIterator]() {
      signal.addEventListener("abort", cancel, { once: true });

      if (signal.aborted) cancel();

      try {
        for (;;) {
          const { value, done } = await reader.read();

          if (done) return;
          yield value;
        }
      } finally {
        signal.removeEventListener("abort", cancel);
        cancel();
      }
    },
  };
}

/**
 * Keeps one GET stream to a host open until `signal` aborts. When it ends,
 * /health is checked at once, so a host that is gone goes offline, and the
 * stream reopens with backoff. A host that does not answer in time is marked
 * offline.
 */
export function keepOpen(input: {
  hosts: GatewayHosts;
  remote: GatewayRemote;
  path: string;
  signal: AbortSignal;
  read(body: http.IncomingMessage): Promise<void>;
}) {
  const { remote, signal } = input;

  void (async () => {
    let delay = FIRST_RETRY_MS;

    while (!signal.aborted) {
      const started = Date.now();
      const abort = new AbortController();
      const leave = () => abort.abort();
      signal.addEventListener("abort", leave, { once: true });
      let timedOut = false;

      const firstByte = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, FIRST_BYTE_TIMEOUT_MS);

      try {
        const response = await send(remote, {
          method: "GET",
          path: input.path,
          headers: remoteHeaders(remote),
          signal: abort.signal,
        });

        clearTimeout(firstByte);

        if (response.statusCode === 200) await input.read(response);
      } catch {
        // Ended: /health decides below.
      } finally {
        clearTimeout(firstByte);
        signal.removeEventListener("abort", leave);
        abort.abort();
      }

      if (signal.aborted) return;

      if (timedOut) input.hosts.failed(remote, NO_ANSWER);
      else input.hosts.recheck(remote);

      if (Date.now() - started >= STEADY_MS) delay = FIRST_RETRY_MS;
      await sleep(jitter(delay), signal);
      delay = Math.min(delay * 2, MAX_RETRY_MS);
    }
  })();
}
