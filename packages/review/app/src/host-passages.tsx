import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  type RefObject,
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { type AskAnchor, resolveAskAnchor } from "./ask-anchor";
import { PASSAGE_BLOCKS, outermost } from "./ask-marks";
import { setCssHighlight } from "./css-highlights";
import { onPlainClick, underRange } from "./passage-clicks";
import { useReviewRoots } from "./review-root-context";
import { motion, space } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

export interface SelectedPassage {
  anchor: AskAnchor;
  quote: string;
}

export interface PassageMark {
  id: string;
  anchor: AskAnchor;
  /** Washed more deeply. */
  active?: boolean;
}

/** What a host adds to the document's text. */
export interface Passages {
  /** Buttons on the toolbar over selected document text. */
  selectionActions?: readonly {
    label: string;
    onSelect(passage: SelectedPassage): void;
  }[];
  /** False leaves Copy ref off that toolbar. */
  copyRef?: boolean;
  /** Found again when the array changes: keep it while the marks hold. */
  marks?: readonly PassageMark[];
  /** A plain click on marked words, with every mark under it. */
  onMarkClick?(ids: string[]): void;
  /** The marks whose words are gone from the document as drawn. */
  onMarksResolved?(lost: string[]): void;
  /** Given, draws each placed mark's note beside its first line: 308px wide
   * in the margin, which the document slides left to make room for, or at
   * the article's right edge, sized by the host, where it has none. */
  renderMarkNote?(id: string, note: { placement: NotePlacement }): ReactNode;
}

/** A mark's words and the review block they are anchored in. */
interface Placed {
  range: Range;
  block: HTMLElement;
}

/** In the margin past the prose, or at the article's right edge where the
 * margin has no room. */
export type NotePlacement = "margin" | "edge";

/** A note as last drawn: its top and the host's node. */
export interface Drawn {
  top: number;
  node: ReactNode;
}

/** A mark's note, laid out from its words. */
export interface Note {
  id: string;
  /** In document order, which the notes stack in. */
  order: number;
  /** Level with its mark's first line, from the article's top. */
  top: number;
  /** From the article's left, past the prose or a wider block. */
  left: number;
  placement: NotePlacement;
  /** Its block is drawn: a collapsed section hides it. */
  shown: boolean;
  /** Its mark is gone: drawn as last seen while it fades. */
  leaving?: Drawn;
}

const NOTE_WIDTH = 308;

/** Past the prose or a wider block. */
const NOTE_GAP = 32;

/** Short of the scroll region's right edge, or of the contents rail. */
const NOTE_INSET = 16;

/** Between stacked notes. */
const NOTE_SPACING = 8;

/** How near the region's left the slide may bring the document's content. */
const CONTENT_INSET = 24;

const NOTE_FADE = 200;

const NO_NOTES: readonly Note[] = [];

/** The left of the leftmost content drawn in `parent`, through wrappers as
 * wide as it: a block's box spans the article, its content is centred. A
 * control hung left of its row, as a section's chevron, counts. */
function contentLeft(parent: Element, box: DOMRectReadOnly): number {
  let left = Infinity;

  for (const child of parent.children) {
    const rect = child.getBoundingClientRect();

    if (!rect.width) continue;

    const wrapper =
      child.childElementCount > 0 &&
      rect.left - box.left < 1 &&
      box.right - rect.right < 1 &&
      ![...child.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );

    if (wrapper) {
      left = Math.min(left, contentLeft(child, rect));
      continue;
    }

    left = Math.min(left, rect.left);

    for (const hung of child.children) {
      const box = hung.getBoundingClientRect();

      if (box.width) left = Math.min(left, box.left);
    }
  }

  return left;
}

/** To layout's 1/64px: mid-slide, a measure through the translate is a hair
 * off, enough to tip a whole pixel. */
const snap = (px: number) => Math.round(px * 64) / 64;

/** Each note, and how far the article slides left for the margin's notes
 * to fit. */
export function layOutNotes(
  article: HTMLElement,
  /** What scrolls the article: the margin runs to its edge. */
  region: HTMLElement,
  proseEnd: number,
  placed: ReadonlyMap<string, Placed>,
) {
  // Measured where the article sits unslid, mid-slide too.
  const own = getComputedStyle(article);
  const slid = Number.parseFloat(own.translate) || 0;
  const frame = article.getBoundingClientRect();
  const left = frame.left + article.clientLeft;
  const top = frame.top + article.clientTop;
  const around = getComputedStyle(region);
  const start = region.getBoundingClientRect().left + region.clientLeft;

  const inset = Math.max(
    NOTE_INSET,
    Number.parseFloat(around.getPropertyValue("--review-rail-gutter")) || 0,
  );

  const edge = start + region.clientWidth - inset - (left - slid);
  const inner = left + Number.parseFloat(own.paddingLeft);

  const content = contentLeft(
    article,
    new DOMRectReadOnly(
      inner,
      frame.top,
      article.clientWidth -
        Number.parseFloat(own.paddingLeft) -
        Number.parseFloat(own.paddingRight),
    ),
  );

  // The content may slide into the article's padding, not near the region's.
  const room = Math.max(
    0,
    snap(
      (Number.isFinite(content) ? content : inner) -
        slid -
        start -
        Number.parseFloat(around.paddingLeft) -
        CONTENT_INSET,
    ),
  );

  let shift = 0;

  const notes = [...placed]
    .sort(([, above], [, below]) =>
      above.range.compareBoundaryPoints(Range.START_TO_START, below.range),
    )
    .map(([id, { range, block }], order): Note => {
      const tops = [...range.getClientRects()].map((rect) => rect.top);

      const first =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;

      const passage = first?.closest<HTMLElement>(PASSAGE_BLOCKS);

      const lane = (
        passage ? outermost(passage, article) : block
      ).getBoundingClientRect();

      const x = Math.round(Math.max(proseEnd, lane.right - left + NOTE_GAP));
      const over = snap(x + NOTE_WIDTH - edge);
      const placement = over > room ? "edge" : "margin";
      const shown = block.checkVisibility();

      if (shown && placement === "margin") shift = Math.max(shift, over);

      return {
        id,
        order,
        top: Math.round(
          (tops.length
            ? Math.min(...tops)
            : block.getBoundingClientRect().top) - top,
        ),
        left: x,
        placement,
        shown,
      };
    });

  return { notes, shift: Math.ceil(shift) };
}

const sameNotes = (before: readonly Note[], after: readonly Note[]) =>
  before.length === after.length &&
  before.every((note, index) => {
    const other = after[index]!;

    return (
      note.id === other.id &&
      note.order === other.order &&
      note.top === other.top &&
      note.left === other.left &&
      note.placement === other.placement &&
      note.shown === other.shown &&
      note.leaving === other.leaving
    );
  });

/** The notes laid out now, and those whose marks just went, where they were
 * drawn. A note keeps its place in the list, so it is never moved. */
export function mergeNotes(
  before: readonly Note[],
  after: readonly Note[],
  drawn: ReadonlyMap<string, Drawn>,
): readonly Note[] {
  const fresh = new Map(after.map((note) => [note.id, note]));

  const kept = before.flatMap((note) => {
    const laid = fresh.get(note.id);

    if (laid) {
      fresh.delete(note.id);

      return [laid];
    }

    const last = note.leaving ?? drawn.get(note.id);

    return last ? [{ ...note, leaving: last }] : [];
  });

  const notes = [...kept, ...fresh.values()];

  return sameNotes(before, notes) ? before : notes;
}

/** Each shown note level with its mark, or 8px under the note above it. */
export function stackNotes(
  notes: readonly Note[],
  heights: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const tops = new Map<string, number>();
  const floors = { margin: -Infinity, edge: -Infinity };

  for (const note of [...notes].sort((a, b) => a.order - b.order)) {
    if (note.leaving || !note.shown) continue;
    const top = Math.max(note.top, floors[note.placement]);

    tops.set(note.id, top);
    floors[note.placement] = top + (heights.get(note.id) ?? 0) + NOTE_SPACING;
  }

  return tops;
}

const sameHeights = (
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
) =>
  before.size === after.size &&
  [...after].every(([id, height]) => before.get(id) === height);

const PassagesContext = createContext<{
  passages: Passages;
  version: number;
} | null>(null);

/** `version` is the board drawn: a live board redraws under one revision. */
export function HostPassagesProvider({
  passages,
  version,
  children,
}: {
  passages: Passages | undefined;
  version: number;
  children: ReactNode;
}) {
  const value = useMemo(
    () => (passages ? { passages, version } : null),
    [passages, version],
  );

  return <PassagesContext value={value}>{children}</PassagesContext>;
}

export const useHostPassages = () =>
  useContext(PassagesContext)?.passages ?? null;

const NO_MARKS: readonly PassageMark[] = [];

/** What a click in the article does itself: the notes, links and controls. */
const CLICKABLE =
  "[data-passage-notes], a, button, input, textarea, select, [role=button]";

/** A mark's range follows its words, so it is found once per version drawn. */
export function HostPassageMarks({
  articleRef,
  revision,
}: {
  articleRef: RefObject<HTMLElement | null>;
  revision: string;
}): ReactNode {
  const passages = useHostPassages();
  const version = useContext(PassagesContext)?.version;
  const shown = Boolean(passages);
  const marks = passages?.marks ?? NO_MARKS;

  const resolved = useEffectEvent((lost: string[]) =>
    passages?.onMarksResolved?.(lost),
  );

  const clicked = useEffectEvent((ids: string[]) =>
    passages?.onMarkClick?.(ids),
  );

  const clickable = Boolean(passages?.onMarkClick);

  const [article, setArticle] = useState<HTMLElement | null>(null);
  const [found, setFound] = useState<ReadonlyMap<string, Placed>>(new Map());
  const [notes, setNotes] = useState(NO_NOTES);
  const [shift, setShift] = useState(0);

  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );

  /** Notes drawn in place once: they may move and fade in. */
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const layer = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const drawn = useRef<ReadonlyMap<string, Drawn>>(new Map());
  const render = passages?.renderMarkNote;
  const noted = Boolean(render);
  const scrollRegion = useReviewRoots()?.scrollRegionRef;

  useEffect(() => setArticle(articleRef.current), [articleRef, revision]);

  useEffect(() => {
    if (!article || !shown) return;

    const frame = requestAnimationFrame(() => {
      const ranges = new Map<string, Placed>();
      const lost: string[] = [];

      for (const mark of marks) {
        const at = resolveAskAnchor(article, mark.anchor);

        if (at) ranges.set(mark.id, at);
        else lost.push(mark.id);
      }

      const washed = (active: boolean) =>
        marks.flatMap((mark) =>
          Boolean(mark.active) === active
            ? (ranges.get(mark.id)?.range ?? [])
            : [],
        );

      setCssHighlight(article, "host-passage", washed(false));
      setCssHighlight(article, "host-passage-active", washed(true), 1);
      setFound(ranges);
      resolved(lost);
    });

    return () => {
      cancelAnimationFrame(frame);
      setCssHighlight(article, "host-passage", []);
      setCssHighlight(article, "host-passage-active", []);
    };
  }, [article, shown, marks, revision, version]);

  // Only a plain click: a drag, a selection or a modifier is the reader's own.
  useEffect(() => {
    if (!article || !clickable || !found.size) return;

    return onPlainClick(article, CLICKABLE, (event) => {
      const hit = [...found].flatMap(([id, { range }]) =>
        underRange(range, event.clientX, event.clientY) ? [id] : [],
      );

      if (hit.length) clicked(hit);
    });
  }, [article, clickable, found]);

  // A resize can wrap a passage onto another line or narrow the margin.
  useLayoutEffect(() => {
    const laidOut = (after: readonly Note[], by: number) => {
      setNotes((before) => mergeNotes(before, after, drawn.current));
      setShift(by);
    };

    if (!article || !noted || !found.size) {
      laidOut(NO_NOTES, 0);

      return;
    }

    const region = scrollRegion?.current ?? article;

    const layOut = () => {
      if (!probe.current) return;

      const laid = layOutNotes(
        article,
        region,
        probe.current.offsetLeft,
        found,
      );

      laidOut(laid.notes, laid.shift);
    };

    layOut();

    const resized = new ResizeObserver(layOut);

    resized.observe(article);
    resized.observe(region);

    for (const { block } of found.values()) resized.observe(block);

    return () => resized.disconnect();
  }, [article, scrollRegion, noted, found]);

  // A note the host grows pushes those under it down.
  useLayoutEffect(() => {
    const wrappers = layer.current?.querySelectorAll<HTMLElement>(
      ":scope > [data-passage-note]",
    );

    if (!wrappers?.length) return;

    const measure = () =>
      setHeights((before) => {
        const after = new Map(
          [...wrappers].map((note) => [
            note.dataset.passageNote!,
            note.offsetHeight,
          ]),
        );

        return sameHeights(before, after) ? before : after;
      });

    measure();

    const resized = new ResizeObserver(measure);

    for (const note of wrappers) resized.observe(note);

    return () => resized.disconnect();
  }, [notes]);

  // A new note is drawn in place, unseen, a frame before it may move or fade
  // in: it never travels from where it was first guessed.
  useEffect(() => {
    const ready = notes.flatMap((note) =>
      !note.leaving && note.shown && heights.get(note.id) ? [note.id] : [],
    );

    if (ready.length === settled.size && ready.every((id) => settled.has(id)))
      return;

    const frame = requestAnimationFrame(() => setSettled(new Set(ready)));

    return () => cancelAnimationFrame(frame);
  }, [notes, heights, settled]);

  useEffect(() => {
    if (!notes.some((note) => note.leaving)) return;

    const faded = setTimeout(
      () => setNotes((before) => before.filter((note) => !note.leaving)),
      NOTE_FADE,
    );

    return () => clearTimeout(faded);
  }, [notes]);

  // Slid left as far as the margin's notes overflow; back home, unslid.
  useLayoutEffect(() => {
    if (!article) return;
    const { style } = article;
    const still = matchMedia(REDUCED_MOTION).matches;

    if (shift) {
      style.transition = still ? "" : SLIDE;
      style.translate = `${-shift}px`;

      return;
    }

    if (!style.translate) return;
    style.translate = "0px";

    const home = setTimeout(
      () => {
        style.translate = "";
        style.transition = "";
      },
      still ? 0 : NOTE_FADE,
    );

    return () => clearTimeout(home);
  }, [article, shift]);

  useLayoutEffect(
    () => () => {
      if (!article?.style.translate) return;
      article.style.translate = "";
      article.style.transition = "";
    },
    [article],
  );

  const tops = stackNotes(notes, heights);

  const nodes = new Map(
    render
      ? notes.flatMap((note) =>
          note.leaving
            ? []
            : [[note.id, render(note.id, { placement: note.placement })]],
        )
      : [],
  );

  useLayoutEffect(() => {
    drawn.current = new Map(
      [...tops].map(([id, top]) => [id, { top, node: nodes.get(id) }]),
    );
  });

  if (!article || !render) return null;

  return createPortal(
    <div
      ref={layer}
      {...stylex.props(styles.layer)}
      data-passage-notes=""
      data-review-copy-ignore=""
    >
      <span ref={probe} {...stylex.props(styles.probe)} />
      {notes.map(({ id, placement, left, leaving }) => {
        const top = leaving?.top ?? tops.get(id);

        return (
          <div
            key={id}
            data-passage-note={id}
            data-placement={placement}
            inert={Boolean(leaving)}
            {...stylex.props(
              styles.note,
              styles[placement],
              top === undefined && styles.hidden,
              !leaving && !settled.has(id) && styles.fresh,
              leaving && styles.leaving,
            )}
            style={{ top, left: placement === "margin" ? left : undefined }}
          >
            {leaving ? leaving.node : nodes.get(id)}
          </div>
        );
      })}
    </div>,
    article,
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const SLIDE = `translate ${NOTE_FADE}ms ease`;

const PROSE_END = `50% + min(100% - 2 * ${tokens.reviewDocumentPaddingInline}, ${tokens.reviewProseMaxWidth}) / 2`;

const styles = stylex.create({
  layer: {
    display: "contents",
  },
  // Placed by measure, so it glides as the notes above it change.
  note: {
    position: "absolute",
    transition: {
      default: `top ${motion.slow} ${motion.ease}, opacity ${motion.medium} ${motion.ease}`,
      [stylex.env.reducedMotion]: "none",
    },
  },
  margin: {
    width: `${NOTE_WIDTH}px`,
  },
  // Over the article's right edge, above the text: the host sizes it.
  edge: {
    zIndex: 1,
    right: space.s8,
  },
  // Its block is not drawn, as in a collapsed section.
  hidden: {
    display: "none",
  },
  fresh: {
    opacity: 0,
    transition: "none",
  },
  leaving: {
    opacity: 0,
  },
  // Where the margin past the prose starts. Not anchored, as the Ask pins'.
  probe: {
    position: "absolute",
    top: 0,
    left: `calc(${PROSE_END} + ${NOTE_GAP}px)`,
    width: 0,
    height: 0,
    visibility: "hidden",
    pointerEvents: "none",
  },
});
