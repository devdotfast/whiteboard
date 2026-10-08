import { eastAsianWidth } from "get-east-asian-width";
import stringWidth from "string-width";
import { sanitizeTerminalLine } from "./sanitize";

const printableAsciiRegex = /^[\u0020-\u007E]*$/;

/** Return whether text contains only single-cell printable ASCII scalars. */
export function isPrintableAsciiText(text: string) {
  return printableAsciiRegex.test(text);
}
// Hunk and string-width both require Intl.Segmenter to preserve terminal grapheme semantics.
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

/** Iterate user-visible text clusters so wide and combining characters stay together. */
export function textClusters(text: string) {
  return Array.from(
    graphemeSegmenter.segment(text),
    (segment) => segment.segment,
  );
}

// Zero-width cluster classes restricted to a single code point. A plain u-flag character
// class stays fast per call, unlike string-width's \p{RGI_Emoji} property-of-strings regex.
const zeroWidthScalarRegex =
  /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]$/u;
const emojiModifierRegex = /^\p{Emoji_Modifier}$/u;
const regionalIndicatorRegex = /^\p{Regional_Indicator}$/u;

/** Return whether one scalar prepends itself to the following grapheme cluster. */
function isGraphemePrepend(codePoint: number) {
  return (
    (codePoint >= 0x0600 && codePoint <= 0x0605) ||
    codePoint === 0x06dd ||
    codePoint === 0x070f ||
    (codePoint >= 0x0890 && codePoint <= 0x0891) ||
    codePoint === 0x08e2 ||
    codePoint === 0x0d4e ||
    codePoint === 0x110bd ||
    codePoint === 0x110cd ||
    (codePoint >= 0x111c2 && codePoint <= 0x111c3) ||
    codePoint === 0x1193f ||
    codePoint === 0x11941 ||
    codePoint === 0x11a3a ||
    (codePoint >= 0x11a84 && codePoint <= 0x11a89) ||
    codePoint === 0x11d46 ||
    codePoint === 0x11f02
  );
}

/** Return whether a common source-code scalar is known to stand alone as one grapheme. */
function isCommonIndependentScalar(codePoint: number) {
  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0x3000 && codePoint <= 0x3029) ||
    (codePoint >= 0x3041 && codePoint <= 0x3096) ||
    (codePoint >= 0x309d && codePoint <= 0x30ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}

/** Return whether one scalar can compose with adjacent scalars into a different-width cluster. */
function scalarRequiresGraphemeComposition(scalar: string, codePoint: number) {
  if (isCommonIndependentScalar(codePoint)) {
    return false;
  }

  // Emoji modifiers compose with a preceding emoji despite having their own scalar width.
  // Hangul Jamo compose across adjacent scalars without a combining-mark code point.
  return (
    zeroWidthScalarRegex.test(scalar) ||
    emojiModifierRegex.test(scalar) ||
    regionalIndicatorRegex.test(scalar) ||
    isGraphemePrepend(codePoint) ||
    codePoint === 0x0e33 ||
    codePoint === 0x0eb3 ||
    codePoint === 0xff9e ||
    codePoint === 0xff9f ||
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97f) ||
    (codePoint >= 0xd7b0 && codePoint <= 0xd7ff)
  );
}

/** Return a direct width for sanitized independent scalars, or null when graphemes must compose. */
export function measureSimpleSanitizedTextWidth(text: string) {
  let width = 0;
  for (const scalar of text) {
    const codePoint = scalar.codePointAt(0)!;
    if (scalarRequiresGraphemeComposition(scalar, codePoint)) {
      return null;
    }
    width += eastAsianWidth(codePoint);
  }
  return width;
}

// Real source reuses a small vocabulary of multi-scalar clusters, while a diff can supply
// unbounded input. Cap both the entry count and cached key length to bound retained text.
export const CLUSTER_WIDTH_CACHE_MAX_ENTRIES = 256;
export const CLUSTER_WIDTH_CACHE_MAX_KEY_CODE_UNITS = 64;

/** Store terminal widths without retaining an unbounded set or size of source clusters. */
export class BoundedClusterWidthCache {
  readonly #entries = new Map<string, number>();

  constructor(
    private readonly maxEntries: number,
    private readonly maxKeyCodeUnits: number,
  ) {}

  /** Return one cached width without changing the FIFO eviction order. */
  get(cluster: string) {
    return this.#entries.get(cluster);
  }

  /** Cache one eligible width and remove the oldest entry when the limit is exceeded. */
  set(cluster: string, width: number) {
    if (cluster.length > this.maxKeyCodeUnits) {
      return;
    }

    this.#entries.set(cluster, width);
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  /** Return the number of retained cluster widths. */
  get size() {
    return this.#entries.size;
  }
}

const cachedClusterWidths = new BoundedClusterWidthCache(
  CLUSTER_WIDTH_CACHE_MAX_ENTRIES,
  CLUSTER_WIDTH_CACHE_MAX_KEY_CODE_UNITS,
);

/** Measure one complex cluster with a small FIFO cache for repeated source glyphs. */
function measureCachedClusterWidth(cluster: string) {
  const cached = cachedClusterWidths.get(cluster);
  if (cached !== undefined) {
    return cached;
  }

  const width = stringWidth(cluster);
  cachedClusterWidths.set(cluster, width);
  return width;
}

/**
 * Measure one grapheme cluster in terminal cells, matching string-width on every input.
 *
 * A single-scalar cluster can never be an emoji sequence, and every single-scalar emoji is East
 * Asian Wide, so a zero-width check plus the EAW table reproduces string-width exactly.
 * Multi-scalar clusters delegate to string-width through a bounded cluster cache.
 */
export function measureClusterWidth(cluster: string): number {
  // Complex source lines still contain mostly ASCII clusters after segmentation.
  if (
    cluster.length === 1 &&
    cluster.charCodeAt(0) >= 0x20 &&
    cluster.charCodeAt(0) <= 0x7e
  ) {
    return 1;
  }

  const codePoint = cluster.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }

  const scalarUnitLength = codePoint > 0xffff ? 2 : 1;

  if (cluster.length === scalarUnitLength) {
    return zeroWidthScalarRegex.test(cluster) ? 0 : eastAsianWidth(codePoint);
  }

  return measureCachedClusterWidth(cluster);
}

/**
 * Return the single UTF-16 code unit repeated across `text`, or null when text mixes characters.
 * Surrogate halves are rejected because they pair into multi-unit clusters (emoji, rare CJK).
 */
function repeatedSingleUnitChar(text: string): string | null {
  if (text.length < 2) {
    return null;
  }

  const unit = text.charCodeAt(0);
  if (unit >= 0xd800 && unit <= 0xdfff) {
    return null;
  }

  for (let index = 1; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== unit) {
      return null;
    }
  }

  return text[0] ?? null;
}

/** Measure terminal width for text that has already passed terminal sanitization. */
export function measureSanitizedTextWidth(text: string) {
  if (printableAsciiRegex.test(text)) {
    return text.length;
  }

  // Fast path for chrome glyph runs like "─".repeat(separatorWidth): a run of one repeated
  // non-combining character is always run-length × single-character width. Each repeated unit
  // with a non-zero width is its own grapheme cluster, so the multiplication is exact.
  const repeatedChar = repeatedSingleUnitChar(text);
  if (repeatedChar !== null) {
    const codePoint = repeatedChar.codePointAt(0)!;
    const charWidth = measureClusterWidth(repeatedChar);
    // Composition-sensitive and zero-width units can merge across repetitions; fall through to
    // whole-text grapheme handling instead of multiplying an isolated scalar width.
    if (
      charWidth > 0 &&
      !scalarRequiresGraphemeComposition(repeatedChar, codePoint)
    ) {
      return charWidth * text.length;
    }
  }

  // Most source text is a sequence of independent scalars. Scan code points directly instead of
  // allocating Intl.Segmenter records. Composition-sensitive text segments once and reuses the
  // bounded cluster cache, avoiding string-width's full emoji-regex pass for every source line.
  const simpleWidth = measureSimpleSanitizedTextWidth(text);
  if (simpleWidth !== null) {
    return simpleWidth;
  }

  // Avoid materializing cluster strings in an array for a width-only traversal.
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    width += measureClusterWidth(segment);
  }
  return width;
}

/** Measure text in terminal cells, treating CJK and emoji clusters as wide. */
export function measureTextWidth(text: string) {
  return measureSanitizedTextWidth(sanitizeTerminalLine(text));
}

export interface WrappedTextChunk {
  text: string;
  width: number;
  startsNewLine: boolean;
}

/** Split already-sanitized text by terminal width without rescanning for control sequences. */
export function wrapSanitizedTextByWidth(
  safeText: string,
  lineWidth: number,
  firstLineWidth = lineWidth,
  firstLineHasContent = false,
): WrappedTextChunk[] {
  const fullWidth = Math.max(0, lineWidth);
  if (fullWidth === 0 || safeText.length === 0) {
    return [];
  }

  const chunks: WrappedTextChunk[] = [];
  let remaining = Math.max(0, Math.min(firstLineWidth, fullWidth));
  let startsNewLine = false;

  if (printableAsciiRegex.test(safeText)) {
    let offset = 0;
    while (offset < safeText.length) {
      if (remaining === 0) {
        remaining = fullWidth;
        startsNewLine = true;
      }

      const chunkWidth = Math.min(remaining, safeText.length - offset);
      chunks.push({
        text: safeText.slice(offset, offset + chunkWidth),
        width: chunkWidth,
        startsNewLine,
      });
      offset += chunkWidth;
      remaining -= chunkWidth;
      startsNewLine = false;
    }
    return chunks;
  }

  let chunkText = "";
  let chunkWidth = 0;
  let existingLineHasContent = firstLineHasContent;
  const flushChunk = () => {
    if (chunkText.length === 0) {
      return;
    }
    chunks.push({ text: chunkText, width: chunkWidth, startsNewLine });
    chunkText = "";
    chunkWidth = 0;
    startsNewLine = false;
  };

  const initialRemaining = remaining;
  const appendCluster = (cluster: string, clusterWidth: number) => {
    if (clusterWidth > remaining) {
      const rowAlreadyStarted =
        existingLineHasContent || remaining < fullWidth || chunkText.length > 0;
      flushChunk();
      remaining = fullWidth;
      startsNewLine = rowAlreadyStarted;
      existingLineHasContent = false;

      // An indivisible cluster wider than a fresh full row stays hidden on that existing row. When
      // prior content exhausted the row, retain one attempted continuation so geometry stays exact.
      if (clusterWidth > fullWidth) {
        if (rowAlreadyStarted) {
          chunks.push({ text: "", width: 0, startsNewLine: true });
        }
        // The indivisible cluster is hidden, but later clusters can still render on this row.
        startsNewLine = false;
        return true;
      }
    }

    chunkText += cluster;
    chunkWidth += clusterWidth;
    remaining -= clusterWidth;
    return true;
  };

  let simpleScalars = true;
  for (const scalar of safeText) {
    const codePoint = scalar.codePointAt(0)!;
    if (scalarRequiresGraphemeComposition(scalar, codePoint)) {
      simpleScalars = false;
      break;
    }
    if (!appendCluster(scalar, eastAsianWidth(codePoint))) {
      flushChunk();
      return chunks;
    }
  }
  if (simpleScalars) {
    flushChunk();
    return chunks;
  }

  // Discard the speculative scalar chunks and preserve exact grapheme behavior for complex text.
  chunks.length = 0;
  remaining = initialRemaining;
  startsNewLine = false;
  chunkText = "";
  existingLineHasContent = firstLineHasContent;
  chunkWidth = 0;
  for (const cluster of textClusters(safeText)) {
    if (!appendCluster(cluster, measureClusterWidth(cluster))) {
      break;
    }
  }

  flushChunk();
  return chunks;
}

/** Slice text by terminal cells without splitting wide or combining clusters. */
export function sliceTextByWidth(text: string, offset: number, width: number) {
  return sliceSanitizedTextByWidth(sanitizeTerminalLine(text), offset, width);
}

/** Slice already-sanitized text without rescanning for terminal control sequences. */
export function sliceSanitizedTextByWidth(
  safeText: string,
  offset: number,
  width: number,
) {
  const startOffset = Math.max(0, offset);
  const maxWidth = Math.max(0, width);
  if (maxWidth === 0) {
    return { text: "", width: 0 };
  }

  if (printableAsciiRegex.test(safeText)) {
    const sliced = safeText.slice(startOffset, startOffset + maxWidth);
    return { text: sliced, width: sliced.length };
  }

  let scalarCursor = 0;
  let scalarUsedWidth = 0;
  let scalarVisibleText = "";
  let simpleScalars = true;
  for (const scalar of safeText) {
    const codePoint = scalar.codePointAt(0)!;
    if (scalarRequiresGraphemeComposition(scalar, codePoint)) {
      simpleScalars = false;
      break;
    }

    const scalarWidth = eastAsianWidth(codePoint);
    const scalarStart = scalarCursor;
    const scalarEnd = scalarCursor + scalarWidth;
    scalarCursor = scalarEnd;
    if (scalarEnd <= startOffset) {
      continue;
    }
    if (scalarStart < startOffset) {
      const hiddenCellWidth =
        Math.min(scalarEnd, startOffset + maxWidth) - startOffset;
      if (hiddenCellWidth > 0) {
        scalarVisibleText += " ".repeat(hiddenCellWidth);
        scalarUsedWidth += hiddenCellWidth;
      }
      continue;
    }
    if (scalarUsedWidth + scalarWidth > maxWidth) {
      return { text: scalarVisibleText, width: scalarUsedWidth };
    }

    scalarVisibleText += scalar;
    scalarUsedWidth += scalarWidth;
  }
  if (simpleScalars) {
    return { text: scalarVisibleText, width: scalarUsedWidth };
  }

  let cursor = 0;
  let usedWidth = 0;
  let visibleText = "";

  for (const cluster of textClusters(safeText)) {
    const clusterWidth = measureClusterWidth(cluster);
    const clusterStart = cursor;
    const clusterEnd = cursor + clusterWidth;
    cursor = clusterEnd;

    if (clusterEnd <= startOffset) {
      continue;
    }
    if (clusterStart < startOffset) {
      const hiddenCellWidth =
        Math.min(clusterEnd, startOffset + maxWidth) - startOffset;
      if (hiddenCellWidth > 0) {
        visibleText += " ".repeat(hiddenCellWidth);
        usedWidth += hiddenCellWidth;
      }
      continue;
    }
    if (usedWidth + clusterWidth > maxWidth) {
      break;
    }

    visibleText += cluster;
    usedWidth += clusterWidth;
  }

  return { text: visibleText, width: usedWidth };
}

