import { slugify, uniqueId } from "./slug.js";

// A board's headings, as the server publishes them and the editor shows
// them: one rule for both, so a heading's anchor is the same in each.

/** Whether a Markdown heading with this many `#`s is one of the board's
 * headings, with an anchor and a Contents row: `##` and `###`. */
export function isBoardHeading(hashes: number | undefined): boolean {
  return hashes === 2 || hashes === 3;
}

/** Hands out heading anchors in document order: `slugify(text)`, made
 * unique, so imported `#fragment` links still land. */
export function headingAnchors(): (text: string) => string {
  const used = new Set<string>();

  return (text) => {
    const id = uniqueId(slugify(text) || "section", used);

    used.add(id);

    return id;
  };
}
