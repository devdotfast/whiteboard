import type { AskHistoryEntry } from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import {
  type CSSProperties,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";

import { AGENT_LOGOS } from "./agent-logos";
import { resolveAskAnchor } from "./ask-anchor";
import { useAskHistory } from "./ask-history";
import { setCssHighlight } from "./css-highlights";
import { useOptionalReviewPanelStore } from "./review-panel";
import type { AskPassage } from "./review-panel-model";
import type { ReviewPanelStore } from "./review-panel-store";
import { fontSize, radius } from "./scale.stylex";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { useTooltip } from "./use-tooltip";

/** The CSS highlight that washes each passage a conversation is about. */
const ASK_HIGHLIGHT = "ask-thread";

/** Deepens the wash of the passage whose pin or words the pointer is on. */
const ASK_ACTIVE_HIGHLIGHT = "ask-thread-active";

/** A passage's conversations, and the elements its pin is laid out by. */
interface AskMark {
  /** The occurrence's place in the document text. */
  key: string;
  quote: string;
  /** Newest first, like the history. */
  entries: AskHistoryEntry[];
  /** Its words, which are washed; code in an editor has none to wash. */
  range?: Range;
  /** Asked-about code, found again where the pointer is. */
  code?: CodeTarget;
  /** What its pin is level with: the passage's block, or the editor. */
  block: HTMLElement;
  /** The outermost list, table or editor, which its pin stays clear of. */
  lane: HTMLElement;
}

/** The pins level with one line, side by side in reading order. */
interface PinRow {
  key: string;
  marks: AskMark[];
  /** From the block's top to the pins, level with their line. */
  offset: number;
}

/** A pin's height: its line, padding and border. */
const PIN_HEIGHT = 22;

/** Pins the gutter has room for side by side. A row with more shows its
 * first and folds the rest into a +N chip, which is narrower than a pin. */
const ROW_PINS = 2;

function fold(row: PinRow) {
  const shown = row.marks.length > ROW_PINS ? 1 : ROW_PINS;

  return { shown: row.marks.slice(0, shown), folded: row.marks.slice(shown) };
}

/** Logos a pin shows; its count covers the rest. */
const PIN_LOGOS = 2;

/** How long an opened row of ticks stays after the pointer leaves it. */
const CLOSE_DELAY = 150;

/** The +N chip's key in `active`: the pointer on it pairs it with every
 * passage it folds. */
const moreKey = (row: PinRow) => `more:${row.key}`;

/** Whether a row would run past the article's edge in its gutter: its
 * probe stands where it would start. Offsets ignore the article's scroll
 * and the row's own place. */
function overflows(article: HTMLElement, probe: HTMLElement, row: HTMLElement) {
  return probe.offsetLeft + row.offsetWidth > article.clientWidth;
}

/** Opens a pin's conversations: the one, or the list of them. Passages
 * folded together open as one list. */
function openMarks(panels: ReviewPanelStore | null, marks: readonly AskMark[]) {
  const entries = marks.flatMap((mark) => mark.entries);
  const [newest] = entries;

  if (!newest) return;

  const passage: AskPassage = {
    quote: marks.map((mark) => mark.quote).join(" · "),
    threadIds: entries.map((entry) => entry.id),
  };

  if (marks.length > 1) passage.several = true;

  panels?.getState().openAskView(
    entries.length === 1
      ? {
          type: "saved",
          threadId: newest.id,
          selection: newest.selection,
          agent: newest.agent,
        }
      : { type: "history", passage },
  );
}

const PASSAGE_BLOCKS =
  "p, li, blockquote, pre, td, th, dd, figcaption, h1, h2, h3, h4, h5, h6";

/** The outermost list or table a block is in, within the article; else the
 * block itself. */
function outermost(block: HTMLElement, article: HTMLElement): HTMLElement {
  let lane = block;

  for (
    let container = block.closest<HTMLElement>(CONTAINER_BLOCKS);
    container && article.contains(container);
    container =
      container.parentElement?.closest<HTMLElement>(CONTAINER_BLOCKS) ?? null
  )
    lane = container;

  return lane;
}

const CONTAINER_BLOCKS = "ul, ol, dl, table";

type CodeTarget = Extract<
  AskHistoryEntry["selection"]["target"],
  { kind: "code" }
>;

/** An editor the canvas shows a file in; it names the file. */
const EDITOR = "[data-review-inline-editor]";

/** Where asked-about code is in the review as rendered now: its lines in
 * an editor showing its file, on the side asked about, or that editor
 * where the lines are not drawn. None when no editor shows the file. */
function placeCode(
  article: HTMLElement,
  target: CodeTarget,
): { editor: HTMLElement; rects: DOMRect[] } | null {
  const editors = [...article.querySelectorAll<HTMLElement>(EDITOR)].filter(
    (editor) => editor.dataset.reviewInlineEditor === target.path,
  );

  for (const editor of editors) {
    const box = editor.getBoundingClientRect();

    const side =
      editor.querySelector(
        target.side === "base" ? ".editor.original" : ".editor.modified",
      ) ?? editor;

    // The editor numbers each line it draws; a line spans the editor.
    const rects = [...side.querySelectorAll(".line-numbers")].flatMap(
      (number) => {
        const line = Number(number.textContent);
        const at = number.getBoundingClientRect();

        return line >= target.startLine && line <= target.endLine && at.height
          ? [new DOMRect(box.left, at.top, box.width, at.height)]
          : [];
      },
    );

    if (rects.length) return { editor, rects };
  }

  const [editor] = editors;

  return editor ? { editor, rects: [editor.getBoundingClientRect()] } : null;
}

interface FoundMarks {
  marks: AskMark[];
  /** Conversations whose passage changed. */
  outdated: Set<string>;
}

/** From a block's top to the middle of its first line, less half a pin. */
function firstLineOffset(block: HTMLElement) {
  const style = getComputedStyle(block);
  const fontSize = parseFloat(style.fontSize);

  const line =
    style.lineHeight === "normal"
      ? fontSize * 1.2
      : parseFloat(style.lineHeight) *
        (style.lineHeight.endsWith("px") ? 1 : fontSize);

  return (
    parseFloat(style.borderTopWidth) +
    parseFloat(style.paddingTop) +
    (line - PIN_HEIGHT) / 2
  );
}

/** From a mark's block's top to its pin, centred on the passage's first
 * line, or on the line of code where the editor has drawn it. */
function offsetOf(article: HTMLElement, mark: AskMark): number {
  const top = mark.block.getBoundingClientRect().top;

  if (mark.code) {
    const [first] = placeCode(article, mark.code)?.rects ?? [];

    // Else level with the editor's top.
    if (!first) return 0;
    const level = Math.min(first.height, PIN_HEIGHT);

    return first.top - top + level / 2 - PIN_HEIGHT / 2;
  }

  const rects = [...(mark.range?.getClientRects() ?? [])];

  // A passage starting where a line wraps has an empty box at the end of
  // the line before.
  const filled = rects.filter((rect) => rect.width > 0);

  const line = (filled.length ? filled : rects).reduce<DOMRect | undefined>(
    (topmost, rect) => (!topmost || rect.top < topmost.top ? rect : topmost),
    undefined,
  );

  // A hidden block draws no lines.
  return line
    ? line.top - top + line.height / 2 - PIN_HEIGHT / 2
    : firstLineOffset(mark.block);
}

/** Lays out the pins as the document is drawn now: in reading order, which
 * is also the order Tab reaches them, each beside its passage's own line.
 * Pins for passages on one line of a block share a row. */
function layOutRows(article: HTMLElement, marks: readonly AskMark[]): PinRow[] {
  const placed = marks.map((mark) => ({
    mark,
    offset: Math.round(offsetOf(article, mark)),
  }));

  placed.sort(
    (above, below) =>
      (above.mark.block === below.mark.block
        ? 0
        : above.mark.block.compareDocumentPosition(below.mark.block) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1) ||
      (above.mark.range && below.mark.range
        ? above.mark.range.compareBoundaryPoints(
            Range.START_TO_START,
            below.mark.range,
          )
        : above.offset - below.offset),
  );

  const rows: PinRow[] = [];

  for (const { mark, offset } of placed) {
    const row = rows.at(-1);

    // Lines are further apart than half a pin; words in a smaller font on
    // the same line are not.
    if (
      row?.marks[0]!.block === mark.block &&
      Math.abs(row.offset - offset) < PIN_HEIGHT / 2
    )
      row.marks.push(mark);
    else rows.push({ key: mark.key, marks: [mark], offset });
  }

  return rows;
}

function sameRows(before: readonly PinRow[], after: readonly PinRow[]) {
  return (
    before.length === after.length &&
    before.every(
      (row, index) =>
        row.offset === after[index]!.offset &&
        row.marks.length === after[index]!.marks.length &&
        row.marks.every((mark, at) => mark === after[index]!.marks[at]),
    )
  );
}

/** Finds each asked-about passage in the document by its anchor, washes
 * it, and names what its pin is laid out by. A passage whose block is
 * gone, or whose words an edit touched, is outdated. */
function findMarks(
  article: HTMLElement,
  entries: readonly AskHistoryEntry[],
): FoundMarks {
  // Conversations about the same words share a mark.
  const found = new Map<string, { range: Range; entries: AskHistoryEntry[] }>();

  // And those about the same lines of a file.
  const code = new Map<
    string,
    { target: CodeTarget; entries: AskHistoryEntry[] }
  >();

  const outdated = new Set<string>();

  for (const entry of entries) {
    const { target } = entry.selection;

    if (target.kind === "code") {
      const key = `code:${target.path}:${target.side}:${target.startLine}:${target.endLine}`;
      const mark = code.get(key);

      if (mark) mark.entries.push(entry);
      else code.set(key, { target, entries: [entry] });
      continue;
    }

    // Only a selection in a review block has a place to mark.
    if (!target.anchor) continue;
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

  const marks: AskMark[] = [];

  for (const [key, { range, entries: asked }] of found) {
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;

    const block = start?.closest<HTMLElement>(PASSAGE_BLOCKS) ?? null;

    if (!block || !article.contains(block)) continue;

    marks.push({
      key,
      quote: range.toString().trim().replace(/\s+/gu, " "),
      entries: asked,
      range,
      block,
      // Pins run in one lane for every kind of block: level with a table
      // narrower than the prose, and outside a block wider than it.
      lane: outermost(block, article),
    });
  }

  for (const [key, { target, entries: asked }] of code) {
    const at = placeCode(article, target);

    // This version shows the file nowhere.
    if (!at) continue;

    // Its pin is outside an editor wider than the prose.
    marks.push({
      key,
      quote: asked[0]!.selection.title,
      entries: asked,
      code: target,
      block: at.editor,
      lane: at.editor,
    });
  }

  setCssHighlight(
    article,
    ASK_HIGHLIGHT,
    marks.flatMap(({ range }) => (range ? [range] : [])),
  );

  return { marks, outdated };
}

function rowStyle(
  prefix: string,
  index: number,
  names: ReadonlyMap<HTMLElement, string>,
  row: PinRow,
): CSSProperties {
  const [lead] = row.marks;

  // SAFETY: the `--ask-pin-*` keys are CSS custom properties, which React
  // forwards to style.setProperty; the CSSProperties typings only omit custom
  // names.
  return {
    "--ask-pin-row": `${prefix}-row-${index}`,
    "--ask-pin-block": names.get(lead!.block),
    "--ask-pin-lane": names.get(lead!.lane),
    "--ask-pin-offset": `${row.offset}px`,
    "--ask-pin-above": `${prefix}-row-${index - 1}`,
  } as CSSProperties;
}

/** Whether the pointer is on a mark's words, or its lines of code. */
function under(article: HTMLElement, mark: AskMark, x: number, y: number) {
  const rects = mark.range
    ? [...mark.range.getClientRects()]
    : mark.code
      ? (placeCode(article, mark.code)?.rects ?? [])
      : [];

  return rects.some(
    (rect) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  );
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
  const [article, setArticle] = useState<HTMLElement | null>(null);

  const [marks, setMarks] = useState<AskMark[]>([]);
  const [rows, setRows] = useState<PinRow[]>([]);

  const [active, setActive] = useState<string | null>(null);

  // When the gutter is too narrow for any row, every row rests as a tick;
  // the pointer or focus on one opens it.
  const [ticked, setTicked] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);

  const rowElements = useRef(
    new Map<string, { row?: HTMLElement; probe?: HTMLElement }>(),
  );

  const closing = useRef(0);

  useEffect(() => setArticle(articleRef.current), [articleRef, revision]);

  useEffect(() => {
    if (!article || !entries?.length) {
      setMarks([]);
      reportOutdated?.(new Set());

      return;
    }

    let frame = 0;

    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const found = findMarks(article, entries);

        setMarks(found.marks);
        reportOutdated?.(found.outdated);
      });
    };

    // An editor draws its lines once it nears the screen, after the marks
    // were placed; asked-about code is then found on its line.
    // Watched only until then: an editor in use changes all the time.
    const files = new Set(
      entries.flatMap(({ selection: { target } }) =>
        target.kind === "code" ? [target.path] : [],
      ),
    );

    const waiting = [...article.querySelectorAll<HTMLElement>(EDITOR)].flatMap(
      (editor) => {
        if (
          !files.has(editor.dataset.reviewInlineEditor ?? "") ||
          editor.querySelector(".line-numbers")
        )
          return [];

        const drawn = new MutationObserver(() => {
          if (!editor.querySelector(".line-numbers")) return;
          drawn.disconnect();
          place();
        });

        drawn.observe(editor, { childList: true, subtree: true });

        return [drawn];
      },
    );

    place();

    return () => {
      cancelAnimationFrame(frame);

      for (const drawn of waiting) drawn.disconnect();

      setCssHighlight(article, ASK_HIGHLIGHT, []);
    };
  }, [article, entries, revision, reportOutdated]);

  // A narrower column can wrap a passage onto another line of its block, so
  // its pin's offset is measured again when the block resizes. Across the
  // page the pins track the text without this, by their anchors.
  useLayoutEffect(() => {
    if (!article || !marks.length) {
      setRows((before) => (before.length ? [] : before));

      return;
    }

    let laid: PinRow[] | undefined;

    // Most resizes leave every passage on its line.
    const layOut = () => {
      const after = layOutRows(article, marks);

      if (laid && sameRows(laid, after)) return;
      laid = after;
      setRows(after);
    };

    layOut();

    const resized = new ResizeObserver(layOut);

    for (const block of new Set(marks.map((mark) => mark.block)))
      resized.observe(block);

    return () => resized.disconnect();
  }, [article, marks]);

  // The pointer on a passage's words pairs it with its pin.
  useEffect(() => {
    if (!article || !marks.length) return;
    let frame = 0;

    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Its pins are inside the article too, and pair themselves.
        if (
          event.target instanceof Element &&
          event.target.closest("[data-ask-pins]")
        )
          return;

        setActive(
          marks.find((mark) =>
            under(article, mark, event.clientX, event.clientY),
          )?.key ?? null,
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

  const revealRequest = history?.revealRequest;

  useEffect(() => {
    if (!article || !revealRequest) return;
    const target = revealRequest.selection.target;

    if (target?.kind !== "text" || !target.anchor) return;
    const at = resolveAskAnchor(article, target.anchor);
    const node = at?.range.startContainer;
    const element = node instanceof Element ? node : node?.parentElement;
    element
      ?.closest(".review-section--collapsed")
      ?.dispatchEvent(new CustomEvent("review-section-expand"));

    const frame = requestAnimationFrame(() =>
      element?.scrollIntoView({ block: "center" }),
    );

    return () => cancelAnimationFrame(frame);
  }, [article, revealRequest, revision]);

  const historyId = history?.previewId ?? (active ? null : revealRequest?.id);

  const activeMarks = useMemo(() => {
    if (historyId)
      return marks.filter((mark) =>
        mark.entries.some((entry) => entry.id === historyId),
      );

    const more = rows.find((row) => moreKey(row) === active);

    return more
      ? fold(more).folded
      : marks.filter((mark) => mark.key === active);
  }, [active, historyId, marks, rows]);

  useEffect(() => {
    const ranges = activeMarks.flatMap(({ range }) => (range ? [range] : []));

    if (!article || !ranges.length) return;
    // Over the resting wash.
    setCssHighlight(article, ASK_ACTIVE_HIGHLIGHT, ranges, 1);

    return () => setCssHighlight(article, ASK_ACTIVE_HIGHLIGHT, []);
  }, [article, activeMarks]);

  const prefix = `--ask-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;

  const names = useMemo(() => {
    const named = new Map<HTMLElement, string>();

    for (const mark of marks)
      for (const element of [mark.block, mark.lane])
        if (!named.has(element)) named.set(element, `${prefix}-${named.size}`);

    return named;
  }, [marks, prefix]);

  useLayoutEffect(() => {
    for (const [element, name] of names)
      element.style.setProperty("anchor-name", name);

    return () => {
      for (const element of names.keys())
        element.style.removeProperty("anchor-name");
    };
  }, [names]);

  // A row with no room in the gutter moves inside, where it would cover the
  // line's end. Then every row rests as a tick in the article's padding, so
  // one page never mixes pins and ticks. Seen again as the article resizes,
  // before it paints; the pins keep their places by their anchors meanwhile.
  const laidRows = useRef(rows);

  const see = useCallback(() => {
    if (!article) return;

    setTicked(
      laidRows.current.some((row) => {
        const { row: element, probe } = rowElements.current.get(row.key) ?? {};

        return !!element && !!probe && overflows(article, probe, element);
      }),
    );
  }, [article]);

  useLayoutEffect(() => {
    laidRows.current = rows;

    const keys = new Set(rows.map((row) => row.key));

    for (const key of rowElements.current.keys())
      if (!keys.has(key)) rowElements.current.delete(key);

    see();
  }, [rows, see]);

  // One observer for the article's life: one made while observers report
  // would miss this round.
  useLayoutEffect(() => {
    if (!article) return;
    const resized = new ResizeObserver(() => flushSync(see));

    resized.observe(article);

    return () => resized.disconnect();
  }, [article, see]);

  useEffect(() => () => clearTimeout(closing.current), []);

  const layer = useMemo(() => {
    const open = (key: string) => {
      clearTimeout(closing.current);
      setOpened(key);
    };

    const close = () => {
      clearTimeout(closing.current);
      closing.current = window.setTimeout(() => setOpened(null), CLOSE_DELAY);
    };

    return rows.flatMap((row, index) => {
      const { shown, folded } = fold(row);

      // The pointer on its words opens a row too.
      const isOpen =
        ticked &&
        (opened === row.key ||
          active === moreKey(row) ||
          row.marks.some((mark) => mark.key === active));

      const elements = rowElements.current.get(row.key) ?? {};

      rowElements.current.set(row.key, elements);

      return [
        <span
          key={`${row.key}:probe`}
          ref={(probe) => {
            elements.probe = probe ?? undefined;
          }}
          {...stylex.props(styles.probe)}
          style={rowStyle(prefix, index, names, row)}
        />,
        <div
          key={row.key}
          ref={(element) => {
            elements.row = element ?? undefined;
          }}
          {...stylex.props(
            styles.row,
            ticked && styles.rowInside,
            ticked && !isOpen && styles.rowResting,
            isOpen && styles.rowOpen,
          )}
          style={rowStyle(prefix, index, names, row)}
          onPointerEnter={ticked ? () => open(row.key) : undefined}
          onPointerLeave={ticked ? close : undefined}
          onFocus={ticked ? () => open(row.key) : undefined}
          onBlur={
            ticked
              ? (event) => {
                  if (!event.currentTarget.contains(event.relatedTarget))
                    close();
                }
              : undefined
          }
        >
          {ticked ? (
            <button
              type="button"
              {...stylex.props(styles.tick)}
              aria-label={
                row.marks.length === 1
                  ? `Show the pin for “${row.marks[0]!.quote.slice(0, 60)}”`
                  : `Show the ${row.marks.length} pins on this line`
              }
              // Into its first pin, shown first so it can take focus.
              onClick={(event) => {
                const pins = event.currentTarget.parentElement;

                flushSync(() => open(row.key));
                pins?.querySelector<HTMLElement>(".ask-mark-pin")?.focus();
              }}
            >
              <span {...stylex.props(styles.tickMark)} />
            </button>
          ) : null}
          {shown.map((mark) => (
            <AskPin
              key={mark.key}
              mark={mark}
              active={mark.key === active}
              onActive={setActive}
            />
          ))}
          {folded.length ? (
            <AskMore
              marks={folded}
              active={
                active === moreKey(row) ||
                folded.some((mark) => mark.key === active)
              }
              onActive={(on) => setActive(on ? moreKey(row) : null)}
            />
          ) : null}
        </div>,
      ];
    });
  }, [active, names, opened, prefix, rows, ticked]);

  if (!article || !marks.length) return null;

  return createPortal(
    <div
      {...stylex.props(styles.layer)}
      data-ask-pins=""
      data-review-copy-ignore=""
    >
      {layer}
    </div>,
    article,
  );
}

function truncate(text: string, length: number) {
  const flat = text.trim().replace(/\s+/gu, " ");

  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/** A passage's pin: its agents, newest first, and how many conversations. */
function AskPin({
  mark,
  active,
  onActive,
}: {
  mark: AskMark;
  active: boolean;
  onActive: (key: string | null) => void;
}): ReactElement {
  const panels = useOptionalReviewPanelStore();
  const [newest] = mark.entries;
  const count = mark.entries.length;
  const agents = [...new Set(mark.entries.map((entry) => entry.agent))];

  const label =
    count === 1
      ? `Open the conversation about “${mark.quote.slice(0, 60)}”`
      : `${count} conversations about “${mark.quote.slice(0, 60)}”`;

  const question = newest?.question ?? newest?.title ?? "";

  const tooltip = useTooltip(
    count === 1
      ? truncate(question, 120)
      : `${count} conversations · ${truncate(question, 100)}`,
    { quick: true },
  );

  return (
    <button
      ref={tooltip}
      type="button"
      // Marker class: the pointer on a pin is not on its words.
      {...withClass("ask-mark-pin", styles.pin)}
      data-active={active || undefined}
      aria-label={label}
      onPointerEnter={() => onActive(mark.key)}
      onPointerLeave={() => onActive(null)}
      onFocus={() => onActive(mark.key)}
      onBlur={() => onActive(null)}
      onClick={() => openMarks(panels, [mark])}
    >
      {/* Newest first; the count says how many conversations there are. */}
      {agents.slice(0, PIN_LOGOS).map((agent) => (
        <span key={agent} {...stylex.props(styles.logoSlot)}>
          {AGENT_LOGOS[agent]({ xstyle: styles.logo })}
        </span>
      ))}
      {/* One conversation needs no count. */}
      {count > 1 ? <span {...stylex.props(styles.count)}>{count}</span> : null}
    </button>
  );
}

/** The passages a row folds past its first pins: how many, and their words
 * in the tooltip. */
function AskMore({
  marks,
  active,
  onActive,
}: {
  marks: AskMark[];
  active: boolean;
  onActive: (on: boolean) => void;
}): ReactElement {
  const panels = useOptionalReviewPanelStore();
  const count = marks.reduce((sum, mark) => sum + mark.entries.length, 0);
  const quotes = marks.map((mark) => `“${truncate(mark.quote, 40)}”`);

  const tooltip = useTooltip(
    marks.length === 1
      ? `${quotes[0]} · ${truncate(marks[0]!.entries[0]?.question ?? marks[0]!.entries[0]?.title ?? "", 80)}`
      : quotes.join(" · "),
    {
      quick: true,
      detail: count === 1 ? undefined : `${count} conversations`,
    },
  );

  return (
    <button
      ref={tooltip}
      type="button"
      {...stylex.props(styles.pin, styles.more)}
      data-active={active || undefined}
      aria-label={`${marks.length} more: ${quotes.join(", ")}`}
      onPointerEnter={() => onActive(true)}
      onPointerLeave={() => onActive(false)}
      onFocus={() => onActive(true)}
      onBlur={() => onActive(false)}
      onClick={() => openMarks(panels, marks)}
    >
      +{marks.length}
    </button>
  );
}

/** 10px past the prose, or past a wider block beside it. */
const GUTTER = `calc(max(50% + min(100% - 2 * ${tokens.reviewDocumentPaddingInline}, ${tokens.reviewProseMaxWidth}) / 2, anchor(var(--ask-pin-lane) right)) + 10px)`;

const styles = stylex.create({
  layer: {
    display: "contents",
  },
  // Beside its passages' line, in the gutter past the prose or a wider
  // block, below the row above; hidden with a collapsed section.
  row: {
    position: "absolute",
    // Its tick under its pins.
    zIndex: 0,
    display: "flex",
    gap: "4px",
    positionAnchor: "var(--ask-pin-block)",
    anchorName: "var(--ask-pin-row)",
    top: "max(calc(anchor(top) + var(--ask-pin-offset)), calc(anchor(var(--ask-pin-above) bottom, -99999px) + 4px))",
    left: GUTTER,
    positionVisibility: "anchors-visible",
  },
  // Where its row would start in the gutter, to see whether it fits.
  probe: {
    position: "absolute",
    positionAnchor: "var(--ask-pin-block)",
    top: "anchor(top)",
    left: GUTTER,
    width: 0,
    height: 0,
    visibility: "hidden",
    pointerEvents: "none",
  },
  // A narrow document has little margin; the pins stay inside it rather
  // than making the page scroll sideways.
  rowInside: {
    left: "auto",
    right: "4px",
  },
  // Only its tick shows.
  rowResting: {
    visibility: "hidden",
  },
  // Over the line's end.
  rowOpen: {
    filter: "drop-shadow(0 2px 6px rgb(0 0 0 / 0.16))",
  },
  // In the article's padding, centred on the line; its hit area reaches the
  // edge.
  tick: {
    position: "absolute",
    zIndex: -1,
    top: 0,
    right: "-4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: `${PIN_HEIGHT}px`,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    visibility: "visible",
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    borderRadius: radius.control,
  },
  tickMark: {
    width: "3px",
    height: "14px",
    borderRadius: radius.hairline,
    backgroundColor: tokens.accent,
  },
  // Quiet at rest, so a much-asked document stays calm; the accent is for
  // the pin paired with the pointer's passage.
  pin: {
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
    borderRadius: radius.control,
    backgroundColor: {
      default: tokens.raised,
      ":is([data-active])": tokens.accentSoft,
      ":focus-visible": tokens.accentSoft,
    },
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.micro,
    lineHeight: "14px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
  logoSlot: {
    display: "flex",
  },
  logo: {
    width: "12px",
    height: "12px",
  },
  more: {
    paddingInline: "4px",
    color: {
      default: tokens.inkMuted,
      ":is([data-active])": tokens.accent,
      ":focus-visible": tokens.accent,
    },
  },
  count: {
    paddingRight: "2px",
  },
});
