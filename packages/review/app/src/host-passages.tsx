import * as stylex from "@stylexjs/stylex";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { type AskAnchor, resolveAskAnchor } from "./ask-anchor";
import { PASSAGE_BLOCKS, outermost, useAnchorNames } from "./ask-marks";
import { setCssHighlight } from "./css-highlights";
import { onPlainClick, underRange } from "./passage-clicks";
import { useReviewRoots } from "./review-root-context";
import { space } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

export interface SelectedPassage {
  anchor: AskAnchor;
  quote: string;
}

export interface PassageMark {
  id: string;
  anchor: AskAnchor;
  /** Washed more deeply; its note shows where the margin has no room. */
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
  /** Given, draws each placed mark's note in the margin beside its first
   * line. */
  renderMarkNote?(id: string): ReactNode;
}

/** A mark's words and the review block they are anchored in. */
interface Placed {
  range: Range;
  block: HTMLElement;
}

/** A mark's note, laid out by its block. */
interface Note {
  id: string;
  block: HTMLElement;
  blockId: string;
  /** From the block's top to the mark's first line. */
  offset: number;
  /** From the block's left to the right of its lane. */
  laneEnd: number;
  width: number;
  /** The margin has no room: over the article's edge, shown when active. */
  inside: boolean;
}

const NOTE_WIDTH = 300;

const NOTE_MIN_WIDTH = 200;

const NOTE_EDGE = 8;

const NO_NOTES: readonly Note[] = [];

function layOutNotes(
  article: HTMLElement,
  /** What scrolls the article: the margin runs to its edge. */
  region: HTMLElement,
  proseEnd: number,
  placed: ReadonlyMap<string, Placed>,
): Note[] {
  const frame = article.getBoundingClientRect();

  return [...placed]
    .sort(([, above], [, below]) =>
      above.range.compareBoundaryPoints(Range.START_TO_START, below.range),
    )
    .map(([id, { range, block }]) => {
      const box = block.getBoundingClientRect();
      const tops = [...range.getClientRects()].map((rect) => rect.top);

      const start =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;

      const passage = start?.closest<HTMLElement>(PASSAGE_BLOCKS);

      const lane = (
        passage ? outermost(passage, article) : block
      ).getBoundingClientRect();

      const left = Math.max(
        proseEnd,
        lane.right - frame.left - article.clientLeft + GUTTER_GAP,
      );

      const edge =
        region.getBoundingClientRect().left +
        region.clientLeft +
        region.clientWidth -
        frame.left -
        article.clientLeft;

      const room = edge - NOTE_EDGE - left;

      return {
        id,
        block,
        blockId: block.dataset.reviewNodeId ?? "",
        offset: Math.round(
          (tops.length ? Math.min(...tops) : box.top) - box.top,
        ),
        laneEnd: Math.round(lane.right - box.left),
        width: Math.round(
          Math.min(
            NOTE_WIDTH,
            room < NOTE_MIN_WIDTH ? article.clientWidth - 2 * NOTE_EDGE : room,
          ),
        ),
        inside: room < NOTE_MIN_WIDTH,
      };
    });
}

const sameNotes = (before: readonly Note[], after: readonly Note[]) =>
  before.length === after.length &&
  before.every((note, index) => {
    const other = after[index]!;

    return (
      note.id === other.id &&
      note.block === other.block &&
      note.offset === other.offset &&
      note.laneEnd === other.laneEnd &&
      note.width === other.width &&
      note.inside === other.inside
    );
  });

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
  const probe = useRef<HTMLSpanElement>(null);
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
    if (!article || !noted || !found.size) {
      setNotes(NO_NOTES);

      return;
    }

    const region = scrollRegion?.current ?? article;

    const layOut = () => {
      if (!probe.current) return;

      const after = layOutNotes(
        article,
        region,
        probe.current.offsetLeft,
        found,
      );

      setNotes((before) => (sameNotes(before, after) ? before : after));
    };

    layOut();

    const resized = new ResizeObserver(layOut);

    resized.observe(article);
    resized.observe(region);

    for (const { block } of found.values()) resized.observe(block);

    return () => resized.disconnect();
  }, [article, scrollRegion, noted, found]);

  const prefix = `--note-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;

  const names = useMemo(
    () =>
      new Map(
        [...new Set(notes.map((note) => note.blockId))].map((id, index) => [
          id,
          `${prefix}-block-${index}`,
        ]),
      ),
    [notes, prefix],
  );

  useAnchorNames(article, names);

  if (!article || !render) return null;

  const active = new Set(marks.flatMap((mark) => (mark.active ? mark.id : [])));

  return createPortal(
    <div
      {...stylex.props(styles.layer)}
      data-passage-notes=""
      data-review-copy-ignore=""
    >
      <span ref={probe} {...stylex.props(styles.probe)} />
      {notes.map((note, index) => (
        <div
          key={note.id}
          data-passage-note={note.id}
          {...stylex.props(
            styles.note,
            note.inside && styles.inside,
            note.inside && !active.has(note.id) && styles.resting,
          )}
          style={
            // SAFETY: CSSProperties omits custom property names.
            {
              "--note-row": `${prefix}-row-${index}`,
              "--note-above": `${prefix}-row-${index - 1}`,
              "--note-block": names.get(note.blockId),
              "--note-offset": `${note.offset}px`,
              "--note-lane-end": `${note.laneEnd}px`,
              "--note-width": `${note.width}px`,
            } as CSSProperties
          }
        >
          {render(note.id)}
        </div>
      ))}
    </div>,
    article,
  );
}

// As the Ask pins' gutter: StyleX reads no constant from another module.
const GUTTER_GAP = 10;

const PROSE_END = `50% + min(100% - 2 * ${tokens.reviewDocumentPaddingInline}, ${tokens.reviewProseMaxWidth}) / 2`;

const styles = stylex.create({
  layer: {
    display: "contents",
  },
  // Beside its mark's first line, past the prose or a wider block, below
  // the note above; hidden with a collapsed section.
  note: {
    position: "absolute",
    positionAnchor: "var(--note-block)",
    anchorName: "var(--note-row)",
    top: `max(calc(anchor(top) + var(--note-offset)), calc(anchor(var(--note-above) bottom, -99999px) + ${space.s8}))`,
    left: `calc(max(${PROSE_END}, anchor(left) + var(--note-lane-end)) + ${GUTTER_GAP}px)`,
    width: "var(--note-width)",
    positionVisibility: "anchors-visible",
  },
  inside: {
    zIndex: 1,
    left: "auto",
    right: space.s8,
    filter: `drop-shadow(0 2px 6px ${tokens.shadowColorSoft})`,
  },
  resting: {
    display: "none",
  },
  // Where the margin past the prose starts. Not anchored, as the Ask pins'.
  probe: {
    position: "absolute",
    top: 0,
    left: `calc(${PROSE_END} + ${GUTTER_GAP}px)`,
    width: 0,
    height: 0,
    visibility: "hidden",
    pointerEvents: "none",
  },
});
