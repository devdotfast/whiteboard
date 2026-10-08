/** Change counts for the headers. The numbers are diffr's `stats`, shown verbatim: folding
 * changes what is on screen, never the count. */
import type { LineCounts } from "./wire";
export type { LineCounts };
export const zero: LineCounts = { added: 0, removed: 0 };
export const add = (a: LineCounts, b: LineCounts): LineCounts => ({ added: a.added + b.added, removed: a.removed + b.removed });
/** GitHub's five-block bar: whole blocks by share, any non-zero side keeps one, the rest grey. */
export function blockBar(counts: LineCounts, blocks = 5): ("added" | "removed" | "neutral")[] {
  const total = counts.added + counts.removed;
  if (total === 0) return Array.from({ length: blocks }, () => "neutral");
  let green = Math.floor((blocks * counts.added) / total);
  let red = Math.floor((blocks * counts.removed) / total);
  if (counts.added > 0 && green === 0) green = 1;
  if (counts.removed > 0 && red === 0) red = 1;
  while (green + red > blocks) {
    if (green >= red) green--;
    else red--;
  }
  return [
    ...Array.from({ length: green }, () => "added" as const),
    ...Array.from({ length: red }, () => "removed" as const),
    ...Array.from({ length: blocks - green - red }, () => "neutral" as const),
  ];
}
export type Snapshot =
  | { type: "revision"; rev: string }
  | { type: "index" }
  | { type: "working_tree" }
  | { type: "empty_tree" }
  | { type: "path"; path: string };
export function snapshotLabel(snapshot: Snapshot): string {
  switch (snapshot.type) {
    case "revision":
      return /^[0-9a-f]{40}$/.test(snapshot.rev) ? snapshot.rev.slice(0, 7) : snapshot.rev;
    case "index":
      return "index";
    case "working_tree":
      return "working tree";
    case "empty_tree":
      return "empty tree";
    case "path":
      return snapshot.path;
  }
}
export const comparisonLabel = (lhs: Snapshot, rhs: Snapshot) => `${snapshotLabel(lhs)}…${snapshotLabel(rhs)}`;
