/** Per-browser preferences. Storage can be missing or refuse (private windows), so every access may fail quietly. */
const PREFIX = "diffr.";

export function readSetting(key: string): string | undefined {
  try {
    return localStorage.getItem(PREFIX + key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeSetting(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Not remembered.
  }
}
