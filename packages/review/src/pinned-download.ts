// Plain Node and zod only: apps/review-desktop/scripts imports this file directly.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { z } from "zod";

const DOWNLOAD_TIMEOUT_MS = 120_000;

interface DownloadOptions {
  size?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Streams `url` into `file` through a temporary file and returns its sha256. */
export async function downloadFile(
  url: string,
  file: string,
  { size, timeoutMs = DOWNLOAD_TIMEOUT_MS, signal }: DownloadOptions = {},
) {
  const { host } = new URL(url);
  const partial = `${file}.${process.pid}.part`;
  let response: Response;

  try {
    response = await fetch(url, {
      signal: AbortSignal.any([
        AbortSignal.timeout(timeoutMs),
        ...(signal ? [signal] : []),
      ]),
    });
  } catch (error) {
    throw new Error(
      `Network error reaching ${host}: ${error instanceof Error ? networkCause(error) : String(error)}`,
    );
  }

  if (!response.ok || !response.body)
    throw new Error(`${host} answered ${response.status} for ${url}`);

  const hash = createHash("sha256");
  let received = 0;

  const tooLarge = new Error(`${url} is larger than its pinned ${size} bytes`);

  try {
    await pipeline(
      // SAFETY: Node's fetch body is its own web stream; the DOM type only
      // names the same object.
      Readable.fromWeb(response.body as WebReadableStream),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          received += chunk.length;

          if (size !== undefined && received > size) throw tooLarge;

          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(partial),
    );
    await rename(partial, file);
  } catch (error) {
    await rm(partial, { force: true });

    if (error === tooLarge) throw error;

    throw new Error(
      `Network error downloading from ${host}: ${error instanceof Error ? networkCause(error) : String(error)}`,
    );
  }

  return hash.digest("hex");
}

/** Leaves a matching `file` in place; otherwise downloads it and checks the pin. */
export async function downloadPinned(
  pin: { url: string; sha256: string; size?: number },
  file: string,
  options: Omit<DownloadOptions, "size"> = {},
) {
  if ((await sha256File(file).catch(() => undefined)) === pin.sha256) return;

  const actual = await downloadFile(pin.url, file, {
    ...options,
    size: pin.size,
  });

  if (actual !== pin.sha256) {
    await rm(file, { force: true });
    throw new Error(
      `Checksum mismatch for ${pin.url}: expected ${pin.sha256}, got ${actual}. The download was deleted.`,
    );
  }
}

export async function sha256File(file: string) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(file)) hash.update(chunk);

  return hash.digest("hex");
}

const networkCauseSchema = z.object({ code: z.string() });

const networkCause = (error: Error) =>
  error.name === "TimeoutError"
    ? "timed out"
    : (networkCauseSchema.safeParse(error.cause).data?.code ?? error.message);
