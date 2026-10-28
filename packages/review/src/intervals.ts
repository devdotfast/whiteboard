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
