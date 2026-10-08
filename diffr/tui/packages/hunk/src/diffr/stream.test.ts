import { expect, test } from "bun:test";
import { readDiffStream } from "./stream";
import { createTestDiffFile, fold, leaf, root } from "./fixture";
import { fileVisibility, type FileChange } from "./wire";
const manifest = (file: ReturnType<typeof createTestDiffFile>): FileChange =>
  ({ file: file.file, status: "modified", tags: [] });
const start = {
  type: "start",
  version: 3,
  lhs: { type: "index" },
  rhs: { type: "working_tree" },
  files: [manifest(createTestDiffFile())],
};
async function decode(events: unknown[]) {
  const text = events.map((e) => JSON.stringify(e)).join("\n"),
    bytes = new TextEncoder().encode(text);
  async function* chunks() {
    for (const byte of bytes) yield Uint8Array.of(byte);
  }
  return Array.fromAsync(readDiffStream(chunks()));
}
test("decode byte-fragmented Unicode stream and preserve region trees", async () => {
  const file = createTestDiffFile();
  file.file = { lhs: { ...file.file.lhs!, path: "变量.ts" }, rhs: { ...file.file.rhs!, path: "变量.ts" } };
  if (file.diff.type !== "text") throw new Error();
  file.diff.lhs!.root.children = [fold(9, [0, 0], [2, 8], [leaf(1, 0, 3)], "Body", ["function"], true)];
  const events = [{...start, files: [manifest(file)]}, file, { type: "complete", succeeded: 1, failed: 0 }];
  expect((await decode(events)) as unknown).toEqual(events);
});
test("omitted defaults are filled in", async () => {
  const file = createTestDiffFile();
  const bare = { type: "file", file: file.file, diff: { type: "text",
    lhs: { text: "a\n", root: { id: 3, fold_state_id: 3, kind: "fold", start: { line: 0, column: 0 }, end: { line: 1, column: 0 },
      indent: { line: 0, column: 0 }, children: [{ id: 1, fold_state_id: 1, kind: "leaf", alignment_id: 0, start: { line: 0, column: 0 }, end: { line: 1, column: 0 } }] } },
    rhs: { text: "a\n", root: { id: 4, fold_state_id: 3, kind: "fold", start: { line: 0, column: 0 }, end: { line: 1, column: 0 },
      indent: { line: 0, column: 0 }, children: [{ id: 2, fold_state_id: 1, kind: "leaf", alignment_id: 0, start: { line: 0, column: 0 }, end: { line: 1, column: 0 } }] } },
    stats: { textual: { added: 0, removed: 0 }, visible: { added: 0, removed: 0 } } } };
  const [, decoded] = await decode([{ ...start, files: [{ file: file.file, status: "modified" }] }, bare,
    { type: "complete", succeeded: 1, failed: 0 }]);
  expect(decoded).toMatchObject({ diff: { lhs: { syntax: [], root: { visibility: { collapsed: false, label: "" },
    children: [{ tags: [], changed: [], children: [], visibility: { collapsed: false, label: "" } }] } } } });
});
test("reject a stream without completion, an unknown version and malformed records", async () => {
  for (const events of [
    [start],
    [{ ...start, version: 1 }, { type: "complete", succeeded: 0, failed: 0 }],
    [start, { type: "file" }, { type: "complete", succeeded: 0, failed: 0 }],
  ])
    await expect(decode(events)).rejects.toThrow();
  const text = new TextEncoder().encode(`${JSON.stringify(start)}\nnot json\n`);
  async function* chunks() {
    yield text;
  }
  await expect(Array.fromAsync(readDiffStream(chunks()))).rejects.toThrow();
});
test("records are trusted as diffr sends them: counts and order are not checked", async () => {
  const file = createTestDiffFile();
  const events = [start, file, file, { type: "complete", succeeded: 5, failed: 0 }];
  expect((await decode(events)).map((event) => event.type)).toEqual(["start", "file", "file", "complete"]);
});
test("file errors and aborts complete without discarding earlier successful results", async () => {
  const file = createTestDiffFile();
  const failed = { lhs: { path: "failed.ts", oid: "3", mode: "100644" }, rhs: { path: "failed.ts", oid: "4", mode: "100644" } };
  const decoded = await decode([
    { ...start, files: [manifest(file), { file: failed, status: "modified" }] },
    file,
    { type: "file", file: failed, error: { code: "not_utf8", message: "unreadable" } },
    { type: "complete", succeeded: 1, failed: 1 },
  ]);
  expect(decoded.length).toBe(4);
  const aborted = await decode([
    { ...start, files: [manifest(file), { file: failed, status: "modified" }] },
    file,
    { type: "complete", succeeded: 1, failed: 0, aborted: { code: "hook_failed", message: "503" } },
  ]);
  expect(aborted.length).toBe(3);
});
test("results arrive in any order", async () => {
  const a = createTestDiffFile(), b = createTestDiffFile();
  b.file = { lhs: { path: "b.ts", oid: "5", mode: "100644" }, rhs: { path: "b.ts", oid: "6", mode: "100644" } };
  expect((await decode([{...start, files: [manifest(a), manifest(b)]}, b, a,
    {type: "complete", succeeded: 2, failed: 0}])).map(e => e.type))
    .toEqual(["start", "file", "file", "complete"]);
});

test("a stream recorded from diffr parses, with manifest tags and each record's visibility", async () => {
  // Recorded with `diffr <base> <head> --format ndjson --syntax --jobs 1` from a repository with
  // one source file and one test file; the test file is hidden by the hide-files plugin.
  const bytes = await Bun.file(new URL("../../../../test/fixtures/comparison.ndjson", import.meta.url)).bytes();
  async function* chunks() {
    yield bytes;
  }
  const events = await Array.fromAsync(readDiffStream(chunks()));
  const [start, source, test, complete] = events;
  if (start.type !== "start" || source.type !== "file" || test.type !== "file") throw new Error("unexpected records");
  expect(start.files.map((file) => [file.file.rhs?.path, file.tags])).toEqual([
    ["src/greet.ts", []],
    ["tests/greet.test.ts", ["test"]],
  ]);
  expect(fileVisibility(source)).toEqual({ collapsed: false, label: "" });
  expect(fileVisibility(test)).toEqual({ collapsed: true, label: "Test file · hidden by default" });
  expect(source.diff?.type === "text" && source.diff.rhs!.syntax.length).toBeGreaterThan(0);
  expect(complete).toEqual({ type: "complete", succeeded: 2, failed: 0 });
});
