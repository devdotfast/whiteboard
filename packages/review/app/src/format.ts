export function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** An ISO timestamp or epoch milliseconds, as "5 min ago" or "Oct 3";
 * `short` writes "5m ago" for a narrow row. */
export function formatRelativeTime(
  timestamp: string | number | null | undefined,
  now = Date.now(),
  { short = false }: { short?: boolean } = {},
): string {
  if (timestamp == null) return "unknown";
  const then = new Date(timestamp).getTime();

  if (!Number.isFinite(then)) return "unknown";
  const elapsed = Math.max(0, now - then);

  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);

  if (minutes < 60) return short ? `${minutes}m ago` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);

  if (hours < 24)
    return short
      ? `${hours}h ago`
      : `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);

  if (days < 7)
    return short
      ? `${days}d ago`
      : `${days} ${days === 1 ? "day" : "days"} ago`;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(then);
}

/** The hour and minute of an ISO timestamp, or "" when it is not one. */
export function formatClockTime(timestamp: string): string {
  const time = new Date(timestamp);

  if (Number.isNaN(time.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(time);
}

/** A span of time to the nearest second: "45s", "3m 20s", "2h 5m". */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "";
  const totalSeconds = Math.round(durationMs / 1000);

  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
