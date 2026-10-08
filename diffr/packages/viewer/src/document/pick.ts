/** Ctrl-P: the comparison's files, ranked by fuzzysort the way quick open and fzf rank paths. */
import fuzzysort, { type Prepared } from "fuzzysort";
import { filePath, type FileChange } from "../protocol/wire";

export interface Pick {
  fileIndex: number;
  path: string;
  /** The path's characters the query matched, for the accent. */
  indexes: readonly number[];
}

/** Each manifest's paths, prepared once: fuzzysort reads a prepared target fastest. */
const prepared = new WeakMap<readonly FileChange[], Prepared[]>();

function preparedPaths(inventory: readonly FileChange[]) {
  let paths = prepared.get(inventory);
  if (!paths) {
    paths = inventory.map((change) => fuzzysort.prepare(filePath(change.file)));
    prepared.set(inventory, paths);
  }
  return paths;
}

/**
 * The files the query matches, best first; every file in tree order when it's empty. Viewed files
 * sink below the rest, keeping their order, so what's left to read rises to the top.
 */
export function rankFiles(inventory: readonly FileChange[], order: readonly number[], query: string,
  viewed: (index: number) => boolean): Pick[] {
  const paths = preparedPaths(inventory);
  const picks: Pick[] = query
    ? fuzzysort.go(query, order, { key: (index) => paths[index], limit: 0, threshold: 0 })
      .map((result) => ({ fileIndex: result.obj, path: result.target, indexes: result.indexes }))
    : order.map((index) => ({ fileIndex: index, path: paths[index]!.target, indexes: [] }));
  return [...picks.filter((pick) => !viewed(pick.fileIndex)), ...picks.filter((pick) => viewed(pick.fileIndex))];
}
