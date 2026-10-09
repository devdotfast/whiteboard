/** Shell-style word splitting: quotes group words, with no escapes or expansion. */
export function splitArgs(text: string): string[] {
  const args: string[] = [];
  let current = "", quote: string | undefined, started = false;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) throw new Error(`Unclosed ${quote} in: ${text}`);
  if (started) args.push(current);
  return args;
}
