// Print diffr's TUI rows as text: the same row model the TUI draws, without colour.
// A collapsed row prints at its fold's `indent`, as the TUI spec places it.
// Usage: bun scripts/pprint.ts <stream.ndjson> [--open id,id,...] [--width N]
import { readFileSync } from "node:fs";
import { rowsForFile, dark } from "../tui/packages/hunk/src/diffr/rows";
import { defaultCollapsed } from "../tui/packages/hunk/src/diffr/regions";
import { eventSchema, type Region, type Source } from "../tui/packages/hunk/src/diffr/wire";
import type { SplitLineCell } from "../tui/packages/hunk/src/ui/diff/diffRowModel";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
const width = Number(flag("--width") ?? 70);
const opened = (flag("--open") ?? "").split(",").filter(Boolean).map(Number);
const events = readFileSync(args[0], "utf8").trim().split("\n").map((line) => eventSchema.parse(JSON.parse(line)));
const files = events.filter((event) => event.type === "file") as any[];

/** Display width of the text before a byte column, tabs to 4. */
const columnWidth = (line: string, column: number) => {
  let width = 0;
  for (const char of new TextDecoder().decode(new TextEncoder().encode(line).slice(0, column)))
    width = char === "\t" ? width + 4 - (width % 4) : width + 1;
  return width;
};
/**
 * Where each fold state's collapsed row sits on one side: a collapsed fold at its own `indent`,
 * a collapsed leaf at its enclosing fold's, column 0 at the top level.
 */
function indents(source: Source | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (!source) return out;
  const lines = source.text.split("\n");
  const walk = (regions: Region[], parent: number) => {
    for (const region of regions) {
      if (region.kind === "leaf") {
        if (!out.has(region.fold_state_id)) out.set(region.fold_state_id, parent);
        continue;
      }
      const own = columnWidth(lines[region.indent.line] ?? "", region.indent.column);
      if (!out.has(region.fold_state_id)) out.set(region.fold_state_id, own);
      walk(region.children, own);
    }
  };
  walk(source.root.children, 0);
  return out;
}

const cell = (c: SplitLineCell | undefined, indent: Map<number, number>): string => {
  if (!c || c.kind === "empty") return "";
  // A collapsed band has no line number; a syntax fold collapses inline on its opener's line.
  if (c.fold?.collapsed && c.lineNumber === undefined)
    return `     ${`▸${c.fold.id}`.padEnd(5)}${" ".repeat(indent.get(c.fold.id) ?? 0)}⋯ ${c.fold.label.split("\n")[0]}`;
  if (c.foldLabel) return `        ${c.spans.map((s) => (s.guide === undefined ? s.text : " ")).join("")}`;
  const sign = { addition: "+", deletion: "-", context: " " }[c.kind];
  const chevron = c.fold ? `${c.fold.collapsed ? "▸" : "▾"}${c.fold.id}` : "";
  return `${String(c.lineNumber ?? "").padStart(4)}${sign}${chevron.padEnd(5)}${c.spans.map((s) => (s.guide === undefined ? s.text : " ")).join("")}`;
};
const fit = (text: string) => (text.length > width ? text.slice(0, width - 1) + "…" : text.padEnd(width));

files.forEach((file, index) => {
  if (file.diff.type !== "text") return;
  const collapsed = defaultCollapsed(file.diff);
  for (const id of opened) collapsed.delete(id);
  const sides = [indents(file.diff.lhs), indents(file.diff.rhs)];
  for (const row of rowsForFile(file, index, "split", dark, collapsed)) {
    if (row.label) console.log(`== ${row.label}`);
    else console.log(`${fit(cell(row.left, sides[0]))} │ ${cell(row.right, sides[1])}`);
  }
});
