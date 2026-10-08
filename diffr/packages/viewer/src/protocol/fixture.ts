/** Provide a hand-authored wire v3 file record for renderer and protocol tests. */
import type { DiffEvent, DiffFile, FileChange, FoldRegion, LeafRegion, Region, Span } from "./wire";
const pos = (line: number, column = 0) => ({ line, column });
/**
 * A leaf whose `id`, `fold_state_id` and `alignment_id` are all `id`. Tests pair two leaves by
 * giving them one number on both sides, so the pair repeats its `id` across sides, which diffr
 * never does; the viewer keys identity per side, and the tests that tell the ids apart set them.
 */
export function leaf(id: number, start: number, end: number, changed: Span[] = []): LeafRegion {
  return { id, fold_state_id: id, alignment_id: id, start: pos(start), end: pos(end), tags: [],
    visibility: { collapsed: false, label: "" }, kind: "leaf", changed, children: [] };
}
export function fold(
  id: number,
  start: [number, number],
  end: [number, number],
  children: Region[],
  label = "Body",
  tags = ["deleted-bodies:function"],
  collapsed = false,
): FoldRegion {
  return { id, fold_state_id: id, start: pos(...start), end: pos(...end), tags,
    visibility: { collapsed, label }, kind: "fold", changed: [], children, indent: pos(...start) };
}
export const line = (line: number, start_column: number, end_column: number): Span =>
  ({ line, start_column, end_column });
export function createTestDiffFile(): DiffFile {
  return {
    type: "file",
    file: {
      lhs: { path: "demo.ts", oid: "1111111", mode: "100644" },
      rhs: { path: "demo.ts", oid: "2222222", mode: "100644" },
    },
    diff: {
      type: "text",
      lhs: {
        text: 'start();\nsend("old");\nfinish();\n',
        syntax: [
          { line: 1, start_column: 0, end_column: 4, capture: "function.call" },
          { line: 1, start_column: 5, end_column: 10, capture: "string" },
        ],
        root: root([leaf(1, 0, 1), leaf(2, 1, 2, [line(1, 6, 9)]), leaf(4, 2, 3)]),
      },
      rhs: {
        text: 'start();\nsend("new");\nextra();\nfinish();\n',
        syntax: [
          { line: 1, start_column: 0, end_column: 4, capture: "function.call" },
          { line: 1, start_column: 5, end_column: 10, capture: "string" },
        ],
        root: root([
          leaf(1, 0, 1),
          leaf(2, 1, 2, [line(1, 6, 9)]),
          leaf(3, 2, 3, [line(2, 0, 8)]),
          leaf(4, 3, 4),
        ], 1001),
      },
      stats: { textual: { added: 2, removed: 1 }, visible: { added: 2, removed: 1 } },
    },
  };
}
/** A side's root: one fold over the whole file. Roots share fold state 1000, clear of the tests' ids. */
export function root(children: Region[], id = 1000, visibility = { collapsed: false, label: "" }): FoldRegion {
  const end = children.at(-1)?.end ?? pos(0);
  return { id, fold_state_id: 1000, start: pos(0), end, tags: [], visibility, kind: "fold", changed: [],
    children, indent: pos(0) };
}
/** The manifest entry a file record answers. */
export const manifestEntry = (file: DiffFile): FileChange => ({ file: file.file, status: "modified", tags: [] });
/** A `start` record whose manifest lists these files. */
export const startFor = (files: DiffFile[]): DiffEvent =>
  ({ type: "start", version: 3, lhs: { type: "index" }, rhs: { type: "working_tree" }, files: files.map(manifestEntry) });
/** Replace both sides with identical numbered lines paired in one leaf. */
export function withIdenticalLines(file: DiffFile, count: number): DiffFile {
  const lines = Array.from({ length: count }, (_, i) => `line ${i}`);
  const text = lines.join("\n");
  if (file.diff.type !== "text") throw new Error("fixture is not a text diff");
  file.diff.lhs = { text, syntax: [], root: root([leaf(1, 0, count)]) };
  file.diff.rhs = { text, syntax: [], root: root([leaf(1, 0, count)], 1001) };
  return file;
}

/** The nested bodies, gap and inline fold from Paper's guide-alignment spec. */
export function createGuideDiffFile(): DiffFile {
  const file = createTestDiffFile();
  if (file.diff.type !== "text") throw new Error();
  for (const side of ["lhs", "rhs"] as const) {
    const text = ["impl Door {", "    fn handle(&self) {", "        if event.open {",
      side === "rhs" ? "            open(true);" : "            open();", "", "            log();",
      "            keep();", "        }", "    }", "    fn other() {", "        one();", "        two();", "    }", "}"];
    const body = (id: number, header: number, end: number, indent: number, children: Region[], collapsed = false) => ({
      ...fold(id, [header + 1, 0], [end, 0], children, "2 lines", [], collapsed),
      indent: pos(header + 1, indent), syntax: {start: pos(header, text[header].length), end: pos(end, text[end].indexOf("}"))},
    });
    const gap = leaf(5, 5, 7);
    gap.visibility = {collapsed: true, label: "2 unchanged lines"};
    const regions = [leaf(1, 0, 1), body(10, 0, 13, 4, [leaf(2, 1, 2), body(20, 1, 8, 8, [leaf(3, 2, 3),
      body(30, 2, 7, 12, [leaf(4, 3, 5, [line(3, 12, text[3].length)]), gap]), leaf(6, 7, 8)]),
      leaf(7, 8, 10), body(40, 9, 12, 8, [leaf(8, 10, 12)], true), leaf(9, 12, 13)]), leaf(11, 13, 14)];
    if (side === "rhs") {
      const unique = (regions: Region[]) => { for (const region of regions) { region.id += 100; unique(region.children); } };
      unique(regions);
    }
    file.diff[side] = {text: text.join("\n") + "\n", syntax: [], root: root(regions, side === "rhs" ? 1001 : 1000)};
  }
  return file;
}
/**
 * The guide file with a second change: `fn handle`'s own line, inside its scope 20 but outside
 * the `if` scope 30, so marking the `if` viewed leaves `handle` partly read.
 */
export function createNestedChangesDiffFile(): DiffFile {
  const file = createGuideDiffFile();
  if (file.diff.type !== "text") throw new Error("The fixture is a text diff");
  for (const source of [file.diff.lhs!, file.diff.rhs!]) {
    const visit = (regions: Region[]) => regions.forEach((region) => {
      if (region.kind === "leaf" && region.alignment_id === 2) region.changed = [line(1, 4, 10)];
      visit(region.children);
    });
    visit(source.root.children);
  }
  return file;
}
/** Rust-style body folds: each covers its body alone, so the lines that open and close a
 * construct are leaves around it, like VS Code's rows. */
export function createFoldedDiffFile(): DiffFile {
  const file = createTestDiffFile();
  const lines = [
    "fn outer() {",      // 0
    "    inner(|| {",    // 1
    "        a();",      // 2
    "        b();",      // 3
    "    });",           // 4
    "    // trailing",   // 5
    "    // comment",    // 6
    "}",                 // 7
  ];
  const text = lines.join("\n") + "\n";
  // ids: 10 outer body (lines 1-6), 11 closure body (2-3), 12 comment (5-6); leaves tile the file.
  const regions = (changed: boolean): Region[] => [
    leaf(1, 0, 1),
    fold(10, [1, 0], [7, 0], [
      leaf(7, 1, 2),
      fold(11, [2, 0], [4, 0], [leaf(2, 2, 3), leaf(3, 3, 4, changed ? [line(3, 8, 12)] : [])]),
      leaf(4, 4, 5),
      // A whole-node fold ending at end of line covers its last line too.
      fold(12, [5, 4], [6, 14], [leaf(5, 5, 7)], "Comment", ["summarize:docstring"]),
    ]),
    leaf(6, 7, 8),
  ];
  if (file.diff.type !== "text") throw new Error("fixture is not a text diff");
  file.diff.lhs = { text, syntax: [], root: root(regions(false))};
  file.diff.rhs = { text, syntax: [], root: root(regions(true))};
  file.diff.stats = { textual: { added: 1, removed: 0 }, visible: { added: 1, removed: 0 } };
  return file;
}
/**
 * The shape diffr emits for a new, summarized function (src/tags/mod.rs, crates/diffr-core/src/protocol/project.rs
 * `syntax_spans`): a one-line docstring region tagged `summarize:docstring`, collapsed
 * with an empty label, sharing fold state 4 with the collapsed function fold after it, right side only.
 */
export function createBundledDiffFile(): DiffFile {
  const file = createTestDiffFile();
  if (file.diff.type !== "text") throw new Error("fixture is not a text diff");
  const text = [
    "];", // 0
    "/// The built-in rule for a path.", // 1
    "pub(crate) fn from_path(path: &str) -> Option<&str> {", // 2
    "    None", // 3
    "}", // 4
  ].join("\n") + "\n";
  const docstring: Region = {
    ...leaf(38, 1, 2), fold_state_id: 4, tags: ["summarize:docstring"], visibility: { collapsed: true, label: "" },
  };
  const body = fold(4, [3, 0], [4, 0], [leaf(5, 3, 4)], "look up path\nreturn None", ["summarize:function"], true);
  file.diff.rhs = { text, syntax: [], root: root([leaf(3, 0, 1), docstring, leaf(7, 2, 3), body, leaf(6, 4, 5)])};
  file.diff.lhs = undefined;
  return file;
}
