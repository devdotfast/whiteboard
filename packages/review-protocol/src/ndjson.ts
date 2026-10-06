/** A per-record size bound; the whole stream is not bounded. */
export interface NdjsonRecordLimit {
  bytes: number;
  message: string;
}

/**
 * Frames NDJSON at 0x0A bytes only. JSON leaves U+2028 and U+2029 unescaped
 * inside strings, and Node 24's readline ends a line at both. Bytes are split
 * before decoding, so a UTF-8 character that spans two chunks stays whole.
 */
export class NdjsonFramer {
  private parts: Uint8Array[] = [];
  private size = 0;
  private readonly decoder = new TextDecoder();

  constructor(private readonly limit?: NdjsonRecordLimit) {}

  /** Yields each record that `chunk` completes, without its newline. */
  *push(chunk: Uint8Array): Generator<string> {
    let start = 0;
    let end: number;

    while ((end = chunk.indexOf(0x0a, start)) !== -1) {
      this.grow(chunk.subarray(start, end));
      yield this.take();
      start = end + 1;
    }

    if (start < chunk.length) this.grow(chunk.subarray(start));
  }

  /** Yields the final record of a stream that ended without a newline. */
  *flush(): Generator<string> {
    if (this.size > 0) yield this.take();
  }

  private grow(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.size += bytes.length;

    if (this.limit && this.size > this.limit.bytes)
      throw new Error(this.limit.message);
  }

  private take(): string {
    let record = this.parts[0] ?? new Uint8Array();

    if (this.parts.length > 1) {
      record = new Uint8Array(this.size);
      let offset = 0;

      for (const part of this.parts) {
        record.set(part, offset);
        offset += part.length;
      }
    }

    this.parts = [];
    this.size = 0;

    return this.decoder.decode(record);
  }
}

/** Frames an async byte stream, such as a child process's stdout. */
export async function* ndjsonRecords(
  chunks: AsyncIterable<Uint8Array>,
  limit?: NdjsonRecordLimit,
): AsyncGenerator<string> {
  const framer = new NdjsonFramer(limit);

  for await (const chunk of chunks) yield* framer.push(chunk);
  yield* framer.flush();
}
