import { parseKey } from "@earendil-works/pi-tui";
import type { KeyPress } from "@diffr/viewer/viewer";

export function paneKey(data: string): KeyPress | undefined {
  const parsed = parseKey(data);
  if (!parsed) return;
  const parts = parsed.split("+");
  let key = parts.pop()!;
  const shift = parts.includes("shift");
  if (shift && /^[a-z]$/.test(key)) key = key.toUpperCase();
  return { key: key === "enter" ? "return" : key,
    ...(parts.includes("ctrl") ? { ctrl: true } : {}),
    ...(parts.includes("alt") || parts.includes("meta") ? { meta: true } : {}),
    ...(shift ? { shift: true } : {}) };
}
