import { expect, test } from "vitest";

import { NdjsonFramer, ndjsonRecords } from "./ndjson.js";

const encode = (text: string) => new TextEncoder().encode(text);

function frame(chunks: Uint8Array[], framer = new NdjsonFramer()) {
  const records = chunks.flatMap((chunk) => [...framer.push(chunk)]);

  return [...records, ...framer.flush()];
}

// JSON.stringify leaves U+2028 and U+2029 unescaped, as diffr does.
const RECORD = JSON.stringify({ text: "a\u2028b\u2029c" });

test("ends a record at 0x0A only", () => {
  expect(frame([encode(`${RECORD}\n${RECORD}\n\n`)])).toEqual([
    RECORD,
    RECORD,
    "",
  ]);
});

test("keeps a record whole at every chunk boundary", () => {
  const bytes = encode(`${RECORD}\n`);

  for (let cut = 1; cut < bytes.length; cut++) {
    expect(frame([bytes.subarray(0, cut), bytes.subarray(cut)])).toEqual([
      RECORD,
    ]);
  }
});

test("flushes a final record that has no newline", () => {
  expect(frame([encode(`${RECORD}\n${RECORD}`)])).toEqual([RECORD, RECORD]);
  expect(frame([encode(`${RECORD}\n`)])).toEqual([RECORD]);
});

test("bounds a record whether it is pending or complete", () => {
  const limit = { bytes: 4, message: "too large" };

  expect(frame([encode("abcd\nefgh\n")], new NdjsonFramer(limit))).toEqual([
    "abcd",
    "efgh",
  ]);
  expect(() => frame([encode("abcde\n")], new NdjsonFramer(limit))).toThrow(
    "too large",
  );
  expect(() =>
    frame([encode("abc"), encode("de")], new NdjsonFramer(limit)),
  ).toThrow("too large");
});

test("yields the records that precede an oversized one", () => {
  const framer = new NdjsonFramer({ bytes: 4, message: "too large" });
  const records = framer.push(encode("abcd\nabcde"));

  expect(records.next().value).toBe("abcd");
  expect(() => records.next()).toThrow("too large");
});

test("frames an async stream of chunks", async () => {
  async function* chunks() {
    yield encode(`${RECORD}\n${RECORD.slice(0, 5)}`);
    yield encode(RECORD.slice(5));
  }

  const records = [];

  for await (const record of ndjsonRecords(chunks())) records.push(record);
  expect(records).toEqual([RECORD, RECORD]);
});
