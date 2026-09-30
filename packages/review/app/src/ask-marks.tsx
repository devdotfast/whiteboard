import type { AskHistoryEntry } from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  type RefObject,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { AGENT_LOGOS } from "./agent-logos";
import { resolveAskAnchor } from "./ask-anchor";
import { useAskHistory } from "./ask-history";
import { useOptionalReviewPanelStore } from "./review-panel";
import { fontSize, radius } from "./scale.stylex";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";

/** The CSS highlight that washes each passage a conversation is about. */
const ASK_HIGHLIGHT = "ask-thread";

/** Deepens the wash of the passage whose pin or words the pointer is on. */
const ASK_ACTIVE_HIGHLIGHT = "ask-thread-active";

/** A box relative to the document. */
interface MarkBox {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/** Where a passage's conversations are marked, relative to the document. */
interface AskMark {
  /** The occurrence's place in the document text. */
  key: string;
  quote: string;
  /** Newest first, like the history. */
  entries: AskHistoryEntry[];
  range: Range;
  /** Where its words are, for telling when the pointer is on them. */
  boxes: MarkBox[];
  /** Level with the passage's first line, or below the pin above it. */
  pinTop: number;
  /** Just past the prose, or a block wider than it, where its pin sits. */
  pinLeft: number;
}

/** A pin's height and the gap below it, before the next pin down. */
const PIN_STEP = 26;

/** Room for a pin with a two-digit count. */
const PIN_WIDTH = 48;

const PASSAGE_BLOCKS =
  "p, li, blockquote, pre, td, th, dd, figcaption, h1, h2, h3, h4, h5, h6";

/** The outermost list or table a block is in, within the article; else the
 * block itself. */
function outermost(block: Element, article: HTMLElement): Element {
  let lane = block;

  for (
    let container = block.closest(CONTAINER_BLOCKS);
    container && article.contains(container);
    container = container.parentElement?.closest(CONTAINER_BLOCKS) ?? null
  )
    lane = container;

  return lane;
}

const CONTAINER_BLOCKS = "ul, ol, dl, table";

/** The document's prose column: centered in the article's content box, at
 * most `--review-prose-max-width` wide. */
function proseColumn(article: HTMLElement, box: DOMRect) {
  const style = getComputedStyle(article);

  const start =
    box.left +
    parseFloat(style.borderLeftWidth) +
    parseFloat(style.paddingLeft);

  const width =
    box.width -
    parseFloat(style.borderLeftWidth) -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight) -
    parseFloat(style.borderRightWidth);

  const prose =
    parseFloat(style.getPropertyValue("--review-prose-max-width")) || width;

  const left = start + Math.max(0, (width - Math.min(width, prose)) / 2);

  return { left, right: left + Math.min(width, prose) };
}

function highlights(document: Document) {
  // SAFETY: lib.dom declares the CSS Custom Highlight API only on
  // globalThis; it is read off the document's window and stays optional
  // because jsdom does not implement it.
  const view = document.defaultView as
    | (Window & {
        CSS?: { highlights?: HighlightRegistry };
        Highlight?: typeof Highlight;
      })
    | null;

  const registry = view?.CSS?.highlights;

  return registry && view?.Highlight
    ? { registry, Highlight: view.Highlight }
    : null;
}

interface PlacedMarks {
  marks: AskMark[];
  /** Conversations whose passage changed. */
  outdated: Set<string>;
}

/** Finds each asked-about passage in the document by its anchor, washes
 * it, and measures where its pin goes. A passage whose block is gone, or
 * whose words an edit touched, is outdated. */
function placeMarks(
  article: HTMLElement,
  entries: readonly AskHistoryEntry[],
): PlacedMarks {
  // Conversations about the same words share a mark.
  const found = new Map<string, { range: Range; entries: AskHistoryEntry[] }>();
  const outdated = new Set<string>();

  for (const entry of entries) {
    const { target } = entry.selection;

    // Only a selection in a review block has a place to mark.
    if (target.kind !== "text" || !target.anchor) continue;
    const at = resolveAskAnchor(article, target.anchor);

    if (!at) {
      outdated.add(entry.id);
      continue;
    }

    const key = `${target.anchor.blockId}:${at.start}:${at.end}`;
    const range = at.range;
    const mark = found.get(key);

    if (mark) mark.entries.push(entry);
    else found.set(key, { range, entries: [entry] });
  }

  const origin = article.getBoundingClientRect();
  const column = proseColumn(article, origin);
  const marks: AskMark[] = [];

  for (const [key, { range, entries: asked }] of found) {
    const rects = [...range.getClientRects()].filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );

    // A collapsed section hides the passage; its mark returns on expand.
    if (!rects.length) continue;

    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;

    const passage = start?.closest(PASSAGE_BLOCKS);
    const top = Math.min(...rects.map((rect) => rect.top));

    // Pins run in one lane for every kind of block, right of the prose
    // column: level with a table narrower than the column, and outside a
    // block wider than it.
    const outer = (
      passage && outermost(passage, article)
    )?.getBoundingClientRect();

    const right = Math.max(
      column.right,
      outer?.right ?? Math.max(...rects.map((rect) => rect.right)),
    );

    marks.push({
      key,
      quote: range.toString().trim().replace(/\s+/gu, " "),
      entries: asked,
      range,
      boxes: rects.map((rect) => ({
        top: rect.top - origin.top,
        left: rect.left - origin.left,
        right: rect.right - origin.left,
        bottom: rect.bottom - origin.top,
      })),
      pinTop: top - origin.top + 3,
      // A narrow document has little margin; the pin stays inside it
      // rather than making the page scroll sideways.
      pinLeft: Math.min(right - origin.left + 10, origin.width - PIN_WIDTH),
    });
  }

  const api = highlights(article.ownerDocument);

  if (api)
    api.registry.set(
      ASK_HIGHLIGHT,
      new api.Highlight(...marks.map((mark) => mark.range)),
    );

  // In reading order, which is also the order Tab reaches the pins. Pins
  // that would overlap, as for passages on one line, stack down the lane.
  marks.sort((above, below) => above.pinTop - below.pinTop);

  for (const [index, mark] of marks.entries()) {
    const above = marks[index - 1];

    if (above) mark.pinTop = Math.max(mark.pinTop, above.pinTop + PIN_STEP);
  }

  return { marks, outdated };
}

function within(box: MarkBox, x: number, y: number) {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/** Marks what each saved conversation asked about, as the margin notes of
 * the review: the passage is washed and a pin beside it reopens it. The
 * pointer on either deepens the wash and outlines the pin, pairing them. */
export function AskThreadMarks({
  articleRef,
  revision,
}: {
  articleRef: RefObject<HTMLElement | null>;
  /** The rendered document; a new one is searched again. */
  revision: string;
}): ReactElement | null {
  const history = useAskHistory();
  const entries = history?.entries;
  const reportOutdated = history?.reportOutdated;
  const panels = useOptionalReviewPanelStore();
  const [article, setArticle] = useState<HTMLElement | null>(null);
  const [marks, setMarks] = useState<AskMark[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => setArticle(articleRef.current), [articleRef, revision]);

  useEffect(() => {
    if (!article || !entries?.length) {
      setMarks([]);
      reportOutdated?.(new Set());

      return;
    }

    let frame = 0;

    // Layout moves passages: a resize, an expanded section, a loaded font.
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const placed = placeMarks(article, entries);

        setMarks(placed.marks);
        reportOutdated?.(placed.outdated);
      });
    };

    const observer = new ResizeObserver(place);

    observer.observe(article);
    place();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();

      highlights(article.ownerDocument)?.registry.delete(ASK_HIGHLIGHT);
    };
  }, [article, entries, revision, reportOutdated]);

  // The pointer on a passage's words pairs it with its pin.
  useEffect(() => {
    if (!article || !marks.length) return;
    let frame = 0;

    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Its pin is inside the article too, and pairs itself.
        if (
          event.target instanceof Element &&
          event.target.closest(".ask-mark-pin")
        )
          return;

        const origin = article.getBoundingClientRect();
        const x = event.clientX - origin.left;
        const y = event.clientY - origin.top;

        setActive(
          marks.find((mark) => mark.boxes.some((box) => within(box, x, y)))
            ?.key ?? null,
        );
      });
    };

    const leave = () => {
      cancelAnimationFrame(frame);
      setActive(null);
    };

    article.addEventListener("pointermove", move);
    article.addEventListener("pointerleave", leave);

    return () => {
      cancelAnimationFrame(frame);
      article.removeEventListener("pointermove", move);
      article.removeEventListener("pointerleave", leave);
    };
  }, [article, marks]);

  const activeRange = marks.find((mark) => mark.key === active)?.range;

  useEffect(() => {
    const api = article && highlights(article.ownerDocument);

    if (!api || !activeRange) return;
    const highlight = new api.Highlight(activeRange);

    // Over the resting wash.
    highlight.priority = 1;
    api.registry.set(ASK_ACTIVE_HIGHLIGHT, highlight);

    return () => {
      api.registry.delete(ASK_ACTIVE_HIGHLIGHT);
    };
  }, [article, activeRange]);

  const layer = useMemo(
    () =>
      marks.map((mark) => {
        const [newest] = mark.entries;
        const count = mark.entries.length;

        const label =
          count === 1
            ? `Open the conversation about “${mark.quote.slice(0, 60)}”`
            : `${count} conversations about “${mark.quote.slice(0, 60)}”`;

        return (
          <button
            key={mark.key}
            type="button"
            // Marker class: the pointer on a pin is not on its words.
            {...withClass("ask-mark-pin", styles.pin)}
            data-active={mark.key === active || undefined}
            style={{ top: mark.pinTop, left: mark.pinLeft }}
            aria-label={label}
            title={newest?.title}
            onPointerEnter={() => setActive(mark.key)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(mark.key)}
            onBlur={() => setActive(null)}
            onClick={() =>
              newest &&
              panels?.getState().openAskView(
                count === 1
                  ? {
                      type: "saved",
                      threadId: newest.id,
                      selection: newest.selection,
                      agent: newest.agent,
                    }
                  : { type: "history" },
              )
            }
          >
            {AGENT_LOGOS[newest?.agent ?? "claude"]({ xstyle: styles.logo })}
            {/* One conversation needs no count. */}
            {count > 1 ? (
              <span {...stylex.props(styles.count)}>{count}</span>
            ) : null}
          </button>
        );
      }),
    [active, marks, panels],
  );

  if (!article || !marks.length) return null;

  return createPortal(
    <div {...stylex.props(styles.layer)} data-review-copy-ignore="">
      {layer}
    </div>,
    article,
  );
}

// The pin paired with the pointer's passage, or with focus.
const pinActive = `color-mix(in srgb, ${tokens.accent} 16%, ${tokens.bg})`;

const styles = stylex.create({
  layer: {
    position: "absolute",
    inset: "0 auto auto 0",
    width: 0,
    height: 0,
  },
  // Quiet at rest, so a much-asked document stays calm; the accent is for
  // the pin paired with the pointer's passage.
  pin: {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    gap: "5px",
    padding: "3px 5px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.ruleSoft,
      ":is([data-active])": tokens.accent,
      ":focus-visible": tokens.accent,
    },
    borderRadius: radius.surface,
    backgroundColor: {
      default: tokens.raised,
      ":is([data-active])": pinActive,
      ":focus-visible": pinActive,
    },
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: { default: null, ":focus-visible": "none" },
  },
  logo: {
    width: "12px",
    height: "12px",
  },
  count: {
    paddingRight: "2px",
  },
});
