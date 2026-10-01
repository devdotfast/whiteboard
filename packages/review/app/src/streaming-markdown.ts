/** An answer still streaming in, with its unfinished end made to read as it
 * will once finished, so no half-written syntax flashes past: a link shows
 * its text until its target arrives, an image waits whole, and open code,
 * bold and strikethrough close. Like Codex's streaming preview and Vercel's
 * remend. Inside an open code fence the text is code already, so it stays. */
export function settleStreamingMarkdown(source: string): string {
  const fences = source.match(/^ {0,3}(?:```|~~~)/gm)?.length ?? 0;

  if (fences % 2 === 1) return source;

  // Links, code spans and emphasis never cross a blank line.
  const start = source.lastIndexOf("\n\n") + 1;
  let tail = source.slice(start);

  tail = tail
    // `![alt](partial`: nothing of it until it is whole.
    .replace(/!\[[^\]\n]*(?:\]\([^)\s]*|\])?$/, "")
    // `[text](partial` and `[text]`: the text alone.
    .replace(/\[([^\]\n]*)\](?:\([^)\s]*)?$/, "$1")
    // `[text`, where the bracket opens a link rather than an index.
    .replace(/(^|[\s(*_~])\[([^\]\n]*)$/, "$1$2");

  const ticks = tail.match(/`+/g) ?? [];

  if (ticks.filter((run) => run.length === 1).length % 2 === 1) tail += "`";

  // Emphasis inside code is code.
  const prose = tail.replace(/`[^`]*`/g, "");

  for (const marker of ["**", "~~"])
    if ((prose.split(marker).length - 1) % 2 === 1) tail += marker;

  return source.slice(0, start) + tail;
}
