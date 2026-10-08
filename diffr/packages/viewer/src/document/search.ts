/** Vim's `/`: plain text, case-blind until the pattern holds a capital, over file paths and code. */

/** One occurrence of the pattern: on a file's header, or on one side of a row as if every fold were open. */
export interface Match {
  fileIndex: number;
  /** The row's key; a header's is `${fileIndex}:header`. */
  key: string;
  side: "left" | "right";
  /** The 1-based source line the row shows on `side`; undefined on a header. */
  line?: number;
  /** Which occurrence on its line or path this is, counted from 0. */
  nth: number;
}

/** Vim's smartcase: a capital in the pattern makes it match case. */
const caseSensitive = (pattern: string) => pattern !== pattern.toLowerCase();

/** Where `pattern` occurs in `text`, as non-overlapping `[start, end)` ranges. */
export function occurrences(text: string, pattern: string): [number, number][] {
  if (!pattern) return [];
  const exact = caseSensitive(pattern);
  const haystack = exact ? text : text.toLowerCase(), needle = exact ? pattern : pattern.toLowerCase();
  const ranges: [number, number][] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length))
    ranges.push([at, at + needle.length]);
  return ranges;
}
