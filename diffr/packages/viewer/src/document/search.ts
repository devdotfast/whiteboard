/** Vim's `/`: plain text, case-blind until the pattern holds a capital, over file paths and code. */

export interface Match {
  fileIndex: number;
  key: string;
  side: "left" | "right";
  line?: number;
}

/** Vim's smartcase: a capital in the pattern makes it match case. */
const caseSensitive = (pattern: string) => pattern !== pattern.toLowerCase();

export function occurrences(text: string, pattern: string): [number, number][] {
  if (!pattern) return [];
  const exact = caseSensitive(pattern);
  const haystack = exact ? text : text.toLowerCase(), needle = exact ? pattern : pattern.toLowerCase();
  const ranges: [number, number][] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length))
    ranges.push([at, at + needle.length]);
  return ranges;
}
