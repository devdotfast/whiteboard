const controlCodeRegex = /[\x00-\x1f\x7f-\x9f]/;
// Keep these global regexes private and use them only with String#replace below.
// Calling test/exec on shared /g regexes would make lastIndex stateful between calls.
const sevenBitControlStrings =
  /\x1b(?:\][\s\S]*?(?:\x07|\x1b\\|\x9c)|[PX^_][\s\S]*?(?:\x1b\\|\x9c)|\[[0-?]*[ -/]*[@-~])/g;
const c1ControlStrings = /[\x90\x98\x9d\x9e\x9f][\s\S]*?(?:\x07|\x1b\\|\x9c)/g;
const c1Csi = /\x9b[0-?]*[ -/]*[@-~]/g;
/** Every control character but tab. */
const controlCharacters = /[\x00-\x08\x0a-\x1f\x7f-\x9f]/g;

/** Sanitize a single terminal row or cell where newlines must never be preserved. */
export function sanitizeTerminalLine(text: string) {
  if (!controlCodeRegex.test(text)) {
    return text;
  }
  return text
    .replace(sevenBitControlStrings, "")
    .replace(c1ControlStrings, "")
    .replace(c1Csi, "")
    .replace(controlCharacters, "");
}

/** Sanitize render spans while preserving their non-text styling metadata. */
export function sanitizeTerminalSpans<T extends { text: string }>(
  spans: T[],
): T[] {
  let sanitized: T[] | null = null;
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    const text = sanitizeTerminalLine(span.text);
    if (text === span.text && text.length > 0) {
      sanitized?.push(span);
      continue;
    }

    // Delay the output copy until the first actual change so already-safe immutable span arrays can
    // flow through hot rendering paths without allocating either an array or replacement objects.
    sanitized ??= spans.slice(0, index);
    if (text.length > 0) {
      sanitized.push({ ...span, text } as T);
    }
  }
  return sanitized ?? spans;
}
