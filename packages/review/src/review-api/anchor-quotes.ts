import {
  type LensSource,
  formatAnchor,
  selectionKey,
} from "@review/lens-selection.js";

import { type Pins, anchorPins, selectionReferences } from "./document.js";
import type { Snapshot } from "./store.js";

export interface AnchorQuote {
  anchor: string;
  first: string;
  last?: string;
}

const QUOTE_LIMIT = 20;

// A blank line quoted as "" reads like a failed quote.
const clip = (line: string) =>
  line.trim() === ""
    ? "(blank line)"
    : line.length > 120
      ? `${line.slice(0, 119)}…`
      : line;

/**
 * The first and last line of each anchor an edit added or changed, so its
 * author can see a range is the one meant without reading the file again.
 * A range that can't be read was already rejected, so it is skipped here.
 * `unquoted` counts the anchors past the limit, so a short list isn't
 * mistaken for a complete one.
 */
export async function anchorQuotes(
  before: Snapshot | undefined,
  after: Snapshot,
  read: (pins: Pins, side: "base" | "head", file: string) => Promise<string>,
): Promise<{ quotes: AnchorQuote[]; unquoted: number }> {
  const key = (id: string, source: LensSource) =>
    `${id}\0${selectionKey(source)}`;

  const known = new Set(
    before
      ? selectionReferences(before.document, { tolerant: true }).map(
          ({ id, source }) => key(id, source),
        )
      : [],
  );

  const added = selectionReferences(after.document, { tolerant: true }).filter(
    ({ id, source }) => !known.has(key(id, source)),
  );

  const quotes = await Promise.all(
    added
      .slice(0, QUOTE_LIMIT)
      .map(async ({ source }): Promise<AnchorQuote | undefined> => {
        try {
          const pins = anchorPins(source, after.pins);

          const line = async (endpoint: LensSource["start"]) =>
            (await read(pins, endpoint.side, source.file)).split("\n")[
              endpoint.line - 1
            ] ?? "";

          const first = clip(await line(source.start));

          const single =
            source.start.side === source.end.side &&
            source.start.line === source.end.line;

          return single
            ? { anchor: formatAnchor(source), first }
            : {
                anchor: formatAnchor(source),
                first,
                last: clip(await line(source.end)),
              };
        } catch {
          return undefined;
        }
      }),
  );

  return {
    quotes: quotes.filter((quote) => quote !== undefined),
    unquoted: Math.max(0, added.length - QUOTE_LIMIT),
  };
}
