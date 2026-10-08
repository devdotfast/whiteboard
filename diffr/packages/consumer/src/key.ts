import type { KeyPress } from "@diffr/viewer/viewer";

/** Kitty reports the base key for shifted symbols; sequence holds the typed character. */
export function terminalKey(key: { name: string; sequence: string; ctrl: boolean; shift: boolean; meta: boolean; option?: boolean; super?: boolean }): KeyPress {
  const meta = key.meta || key.option === true || key.super === true;
  const typed = !key.ctrl && !meta && key.sequence !== " " && /^[^\x00-\x1f\x7f]$/u.test(key.sequence)
    ? key.sequence : undefined;
  return { key: typed ?? (key.shift && /^[a-z]$/.test(key.name) ? key.name.toUpperCase() : key.name),
    ...(key.ctrl ? { ctrl: true } : {}), ...(key.shift ? { shift: true } : {}), ...(meta ? { meta: true } : {}) };
}
