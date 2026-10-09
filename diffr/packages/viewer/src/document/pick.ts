import fuzzysort, { type Prepared } from "fuzzysort";
import { filePath, type FileChange } from "../protocol/wire";

export interface Pick {
  fileIndex: number;
  path: string;
  indexes: readonly number[];
}

const prepared = new WeakMap<readonly FileChange[], Prepared[]>();

function preparedPaths(inventory: readonly FileChange[]) {
  let paths = prepared.get(inventory);
  if (!paths) {
    paths = inventory.map((change) => fuzzysort.prepare(filePath(change.file)));
    prepared.set(inventory, paths);
  }
  return paths;
}

/** Viewed files sink, keeping order. */
export function rankFiles(inventory: readonly FileChange[], order: readonly number[], query: string,
  viewed: (index: number) => boolean): Pick[] {
  const paths = preparedPaths(inventory);
  const picks: Pick[] = query
    ? fuzzysort.go(query, order, { key: (index) => paths[index], limit: 0, threshold: 0 })
      .map((result) => ({ fileIndex: result.obj, path: result.target, indexes: result.indexes }))
    : order.map((index) => ({ fileIndex: index, path: paths[index]!.target, indexes: [] }));
  return [...picks.filter((pick) => !viewed(pick.fileIndex)), ...picks.filter((pick) => viewed(pick.fileIndex))];
}
