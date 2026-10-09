import { isKeyRelease, parseKey } from "@earendil-works/pi-tui";
import type { KeyPress } from "@diffr/viewer/viewer";

export function paneKey(data: string): KeyPress | undefined {
  if (isKeyRelease(data)) return;
  const parsed = parseKey(data);
  if (!parsed) return;
  const parts = parsed.split("+");
  let key = parts.pop()!;
  const shift = parts.includes("shift");
  if (/^[^\x00-\x1f\x7f]$/u.test(data)) key = data;
  else if (shift && /^[a-z]$/.test(key)) key = key.toUpperCase();
  return { key: key === "enter" ? "return" : key,
    ...(parts.includes("ctrl") ? { ctrl: true } : {}),
    ...(parts.includes("alt") || parts.includes("meta") ? { meta: true } : {}),
    ...(shift ? { shift: true } : {}) };
}
