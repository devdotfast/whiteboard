// Full v3/v4 contract: diffr-ts/src/contract.ts.
/** Parse diffr's wire v3 (crates/diffr-core/src/protocol/mod.rs, docs/streaming.md): tagged enums, pairings by presence, defaults omitted. The shapes are checked; invariants between records are diffr's and trusted. */
import { z } from "zod";
const uint = z.number().int().nonnegative();
/** `{lhs, rhs}`, `{lhs}` or `{rhs}`; diffr never sends neither. */
function pairing<T extends z.ZodTypeAny>(item: T) {
  return z.object({ lhs: item.optional(), rhs: item.optional() });
}
export type Pairing<T> = { lhs?: T; rhs?: T };
const fileRef = z.object({ path: z.string(), oid: z.string(), mode: z.string() });
const visibility = z.object({
  collapsed: z.boolean().default(false),
  label: z.string().default(""),
});
const problem = z.object({ code: z.string(), message: z.string() });
const fileChange = z.object({
  file: pairing(fileRef),
  status: z.enum(["added", "deleted", "modified", "renamed", "copied", "type_changed"]),
  /** What the file is (`generated`, `vendored`, `docs`, `test`, or a `diffr-tags` attribute), sorted. */
  tags: z.array(z.string()).default([]),
});
const snapshot = z.discriminatedUnion("type", [
  z.object({ type: z.literal("revision"), rev: z.string() }),
  z.object({ type: z.literal("index") }),
  z.object({ type: z.literal("working_tree") }),
  z.object({ type: z.literal("empty_tree") }),
  z.object({ type: z.literal("path"), path: z.string() }),
]);
const sourcePos = z.object({ line: uint, column: uint });
const span = z.object({ line: uint, start_column: uint, end_column: uint });
const syntaxSpan = span.extend({ capture: z.string() });
interface RegionBase {
  /** Names this region, unique within the file across both sides. Keys anything about the region itself. */
  id: number;
  /** Regions sharing it open and close together, on either side. Keys collapse state. */
  fold_state_id: number;
  start: { line: number; column: number };
  end: { line: number; column: number };
  tags: string[];
  visibility: { collapsed: boolean; label: string };
  changed: { line: number; start_column: number; end_column: number }[];
  children: Region[];
}
export interface LeafRegion extends RegionBase {
  kind: "leaf";
  /** Same value on the other side: the leaf whose rows line up with this one, one-to-one. Keys the row zip. */
  alignment_id: number;
  /** The partner leaf's `id` on the other side; absent when added or deleted. */
  pair?: number;
}
export interface FoldRegion extends RegionBase {
  kind: "fold";
  /** Where the fold's content starts. Collapsed rows sit at this column. */
  indent: { line: number; column: number };
  /** From the opener to the closer, before rounding to lines. Absent without an opener. */
  syntax?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
export type Region = LeafRegion | FoldRegion;
const regionBase = z.object({
  id: uint,
  fold_state_id: uint,
  start: sourcePos,
  end: sourcePos,
  tags: z.array(z.string()).default([]),
  visibility: visibility.default({ collapsed: false, label: "" }),
});
const region: z.ZodType<Region> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    regionBase.extend({ kind: z.literal("leaf"), alignment_id: uint, pair: uint.optional(), changed: z.array(span).default([]) })
      .transform((leaf) => ({ ...leaf, children: [] as Region[] })),
    regionBase.extend({ kind: z.literal("fold"), children: z.array(region), indent: sourcePos,
      syntax: z.object({ start: sourcePos, end: sourcePos }).optional() })
      .transform((fold) => ({ ...fold, changed: [] as Region["changed"] })),
  ]),
);
const source = z.object({
  text: z.string(),
  syntax: z.array(syntaxSpan).default([]),
  /** The whole file, as one fold. Both sides' roots share a fold_state_id; its visibility is the file's. */
  root: region,
});
const lineCounts = z.object({ added: uint, removed: uint });
const stats = z.object({
  textual: lineCounts,
  /** Changed lines shown under diffr's default fold state; the frontend adjusts it as folds toggle. */
  visible: lineCounts,
  /** Present when tree-sitter did not run and this is a line diff. */
  fallback: problem.optional(),
});
const diff = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), lhs: source.optional(), rhs: source.optional(), stats }),
  z.object({
    type: z.literal("binary"),
    lhs: z.object({ size: uint }).optional(),
    rhs: z.object({ size: uint }).optional(),
  }),
]);
/** diffr sends exactly one of `diff` and `error`. */
const fileEvent = z.object({
  type: z.literal("file"),
  file: pairing(fileRef),
  diff: diff.optional(),
  error: problem.optional(),
});
export const eventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    version: z.literal(3),
    lhs: snapshot,
    rhs: snapshot,
    files: z.array(fileChange),
  }),
  fileEvent,
  z.object({ type: z.literal("complete"), succeeded: uint, failed: uint, aborted: problem.optional() }),
]);
export type FileRef = z.infer<typeof fileRef>;
export type FileChange = z.infer<typeof fileChange>;
export type Visibility = z.infer<typeof visibility>;
export type Problem = z.infer<typeof problem>;
export type Source = z.infer<typeof source>;
export type TextDiff = Extract<z.infer<typeof diff>, { type: "text" }>;
export type Diff = z.infer<typeof diff>;
export type Span = z.infer<typeof span>;
export type SyntaxSpan = z.infer<typeof syntaxSpan>;
export type Stats = z.infer<typeof stats>;
export type LineCounts = z.infer<typeof lineCounts>;
export type DiffEvent = z.infer<typeof eventSchema>;
export type FileEvent = Extract<DiffEvent, { type: "file" }>;
/** A file record that carries a diff; failures are kept separately by the store. */
export type DiffFile = FileEvent & { diff: Diff };
export const fileIdentity = (file: Pairing<FileRef>) =>
  JSON.stringify([file.lhs?.path ?? null, file.rhs?.path ?? null]);
export const filePath = (file: Pairing<FileRef>) => file.rhs?.path ?? file.lhs?.path ?? "";
/** How a file starts out: its root's visibility. A hidden file is collapsed behind its reason. */
export function fileVisibility(file: FileEvent): Visibility {
  return file.diff?.type === "text" ? (file.diff.rhs ?? file.diff.lhs)!.root.visibility : { collapsed: false, label: "" };
}
