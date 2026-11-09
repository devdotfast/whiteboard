/** Zero-based, half-open intervals; always normalized at the storage boundary. */
export type LineInterval = [number, number];

export function unionIntervals(
  ranges: readonly LineInterval[],
): LineInterval[] {
  const result: LineInterval[] = [];

  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (end <= start) continue;
    const last = result.at(-1);

    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }

  return result;
}

export function intersectIntervals(
  left: readonly LineInterval[],
  right: readonly LineInterval[],
): LineInterval[] {
  const result: LineInterval[] = [];

  const a = unionIntervals(left),
    b = unionIntervals(right);

  let i = 0,
    j = 0;

  while (i < a.length && j < b.length) {
    const start = Math.max(a[i][0], b[j][0]),
      end = Math.min(a[i][1], b[j][1]);

    if (start < end) result.push([start, end]);

    if (a[i][1] < b[j][1]) i++;
    else j++;
  }

  return result;
}

export function subtractIntervals(
  from: readonly LineInterval[],
  remove: readonly LineInterval[],
): LineInterval[] {
  const result: LineInterval[] = [];
  const removed = unionIntervals(remove);

  for (const [start, end] of unionIntervals(from)) {
    let cursor = start;

    for (const [lower, upper] of removed) {
      if (upper <= cursor) continue;

      if (lower >= end) break;

      if (lower > cursor) result.push([cursor, lower]);
      cursor = Math.min(end, Math.max(cursor, upper));
    }

    if (cursor < end) result.push([cursor, end]);
  }

  return result;
}
