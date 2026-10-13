import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import {
  REVIEW_CLIENT_HEADER,
  REVIEW_CLIENT_REMOTE,
} from "@dev.fast/review-protocol";
import { type Dispatcher, request } from "undici";
import { z } from "zod";

import { StreamLimitError } from "./bounded-stream.js";
import type { GatewayHosts, GatewayRemote } from "./review-gateway-hosts.js";

export const FIRST_RETRY_MS = 500;

export const MAX_RETRY_MS = 30_000;

export const FIRST_BYTE_TIMEOUT_MS = 10_000;

const NO_ANSWER = `it did not answer within ${FIRST_BYTE_TIMEOUT_MS / 1_000} seconds`;

export const jitter = (ms: number) => ms * (0.75 + Math.random() * 0.5);

const STEADY_MS = 10_000;

const MAX_LINE_CHARS = 64 * 1024 * 1024;

const sleep = (ms: number, signal: AbortSignal) =>
  delay(ms, undefined, { signal }).catch(() => undefined);

export async function reconnect(
  signal: AbortSignal,
  attempt: () => Promise<void>,
) {
  let wait = FIRST_RETRY_MS;

  while (!signal.aborted) {
    const started = Date.now();
    await attempt();

    if (signal.aborted) return;

    if (Date.now() - started >= STEADY_MS) wait = FIRST_RETRY_MS;
    await sleep(jitter(wait), signal);
    wait = Math.min(wait * 2, MAX_RETRY_MS);
  }
}

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

export function keepOpen(input: {
  hosts: GatewayHosts;
  remote: GatewayRemote;
  path: string;
  signal: AbortSignal;
  read(body: AsyncIterable<Uint8Array>): Promise<void>;
}) {
  const { remote, signal } = input;

  void reconnect(signal, async () => {
    let timedOut = false;

    try {
      const response = await send(remote, {
        method: "GET",
        path: input.path,
        headers: remoteHeaders(remote),
        signal,
      });

      if (response.statusCode === 200) await input.read(response.body);
      else await response.body.dump();
    } catch (error) {
      timedOut = errorCode(error) === "UND_ERR_HEADERS_TIMEOUT";
    }

    if (signal.aborted) return;

    if (timedOut) input.hosts.failed(remote, NO_ANSWER);
    else input.hosts.recheck(remote);
  });
}

export const remoteHeaders = (remote: GatewayRemote) => ({
  "x-review-token": remote.endpoint?.token ?? "",
  [REVIEW_CLIENT_HEADER]: REVIEW_CLIENT_REMOTE,
});

export async function send(
  remote: GatewayRemote,
  input: {
    method: Dispatcher.HttpMethod;
    path: string;
    headers?: Record<string, string>;
    body?: Buffer | Readable;
    signal?: AbortSignal;
  },
  retry = true,
): Promise<Dispatcher.ResponseData> {
  if (!remote.endpoint) throw new Error(`${remote.alias} has no endpoint.`);

  try {
    return await request(new URL(input.path, remote.endpoint.url), {
      dispatcher: remote.dispatcher,
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: input.signal,
      headersTimeout: FIRST_BYTE_TIMEOUT_MS,
      bodyTimeout: 0,
    });
  } catch (error) {
    if (
      retry &&
      !input.signal?.aborted &&
      !(input.body instanceof Readable) &&
      errorCode(error) === "UND_ERR_SOCKET" &&
      (input.body === undefined || reusedSocket(error))
    )
      return send(remote, input, false);

    throw error;
  }
}

export async function readBody(
  body: Dispatcher.ResponseData["body"],
  limit: number,
) {
  const parts: Buffer[] = [];
  let size = 0;

  for await (const part of body) {
    // SAFETY: undici's body yields Buffers.
    const chunk = part as Buffer;
    size += chunk.byteLength;

    if (size > limit) {
      body.destroy();
      throw new StreamLimitError();
    }

    parts.push(chunk);
  }

  return Buffer.concat(parts, size);
}

const codedError = z.object({ code: z.string() });

const socketError = z.object({ socket: z.object({ bytesRead: z.number() }) });

// undici has no reusedSocket; a socket that already read bytes served an earlier response.
const reusedSocket = (cause: unknown) =>
  (socketError.safeParse(cause).data?.socket.bytesRead ?? 0) > 0;

const ERROR_WORDS = new Map([
  ["ECONNREFUSED", "it refused the connection"],
  ["ECONNRESET", "it closed the connection"],
  ["UND_ERR_SOCKET", "it closed the connection"],
  ["ETIMEDOUT", "it did not answer"],
  ["UND_ERR_HEADERS_TIMEOUT", NO_ANSWER],
]);

export function errorCode(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);

  return (
    codedError.safeParse(cause).data?.code ??
    codedError.safeParse(cause.cause).data?.code ??
    cause.message
  );
}

export function errorText(cause: unknown): string {
  const code = errorCode(cause);

  return ERROR_WORDS.get(code) ?? code;
}
