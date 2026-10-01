import type { AskHistoryEntry } from "@review/ask/thread-state";
import * as stylex from "@stylexjs/stylex";
import {
  type CSSProperties,
  type ReactElement,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
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
  /** From the block's top to the pin, level with the passage's line. */
  offset: number;
}

/** The pins level with one line, side by side in reading order. */
interface PinRow {
  key: string;
  marks: AskMark[];
}

/** A pin's height: its line, padding and border. */
const PIN_HEIGHT = 22;

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
  rows: PinRow[];
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
      offset: firstLineOffset(block),
    });
  }

  for (const [key, { target, entries: asked }] of code) {
    const at = placeCode(article, target);

    // This version shows the file nowhere.
    if (!at) continue;

    const top = at.editor.getBoundingClientRect().top;
    const [first] = at.rects;

    // Level with the line where the editor has drawn it, else with the
    // editor's top; outside an editor wider than the prose.
    const level = Math.min(first?.height ?? 0, PIN_HEIGHT);

    marks.push({
      key,
      quote: asked[0]!.selection.title,
      entries: asked,
      code: target,
      block: at.editor,
      lane: at.editor,
      offset: first ? first.top - top + level / 2 - PIN_HEIGHT / 2 : 0,
    });
  }

  const api = highlights(article.ownerDocument);

  if (api)
    api.registry.set(
      ASK_HIGHLIGHT,
      new api.Highlight(
        ...marks.flatMap(({ range }) => (range ? [range] : [])),
      ),
    );

  // In reading order, which is also the order Tab reaches the pins. Pins
  // for passages on one line of a block sit side by side on it.
  marks.sort(
    (above, below) =>
      (above.block === below.block
        ? 0
        : above.block.compareDocumentPosition(below.block) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1) ||
      above.offset - below.offset ||
      (above.range && below.range
        ? above.range.compareBoundaryPoints(Range.START_TO_START, below.range)
        : 0),
  );

  const rows: PinRow[] = [];

  for (const mark of marks) {
    const row = rows.at(-1);
    const [lead] = row?.marks ?? [];

    if (lead && lead.block === mark.block && lead.offset === mark.offset)
      row!.marks.push(mark);
    else rows.push({ key: mark.key, marks: [mark] });
  }

  return { marks, rows, outdated };
}

function rowStyle(
  prefix: string,
  index: number,
  names: ReadonlyMap<HTMLElement, string>,
  lead: AskMark,
): CSSProperties {
  // SAFETY: the `--ask-pin-*` keys are CSS custom properties, which React
  // forwards to style.setProperty; the CSSProperties typings only omit custom
  // names.
  return {
    "--ask-pin-row": `${prefix}-row-${index}`,
    "--ask-pin-block": names.get(lead.block),
    "--ask-pin-lane": names.get(lead.lane),
    "--ask-pin-offset": `${lead.offset}px`,
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

  const [{ marks, rows }, setPlaced] = useState<{
    marks: AskMark[];
    rows: PinRow[];
  }>({ marks: [], rows: [] });

  const [active, setActive] = useState<string | null>(null);

  useEffect(() => setArticle(articleRef.current), [articleRef, revision]);

  useEffect(() => {
    if (!article || !entries?.length) {
      setPlaced({ marks: [], rows: [] });
      reportOutdated?.(new Set());

      return;
    }

    let frame = 0;

    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const found = findMarks(article, entries);

        setPlaced(found);
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

  const activeRange = marks.find((mark) =>
    historyId
      ? mark.entries.some((entry) => entry.id === historyId)
      : mark.key === active,
  )?.range;

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

  const layer = useMemo(
    () =>
      rows.map((row, index) => {
        const [lead] = row.marks;

        return (
          <div
            key={row.key}
            {...stylex.props(styles.row)}
            style={rowStyle(prefix, index, names, lead!)}
          >
            {row.marks.map((mark) => (
              <AskPin
                key={mark.key}
                mark={mark}
                active={mark.key === active}
                onActive={setActive}
              />
            ))}
          </div>
        );
      }),
    [active, names, prefix, rows],
  );

  if (!article || !marks.length) return null;

  return createPortal(
    <div {...stylex.props(styles.layer)} data-review-copy-ignore="">
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
            : {
                type: "history",
                passage: {
                  quote: mark.quote,
                  threadIds: mark.entries.map((entry) => entry.id),
                },
              },
        )
      }
    >
      {[...new Set(mark.entries.map((entry) => entry.agent))].map((agent) => (
        <span key={agent} {...stylex.props(styles.logoSlot)}>
          {AGENT_LOGOS[agent]({ xstyle: styles.logo })}
        </span>
      ))}
      {/* One conversation needs no count. */}
      {count > 1 ? <span {...stylex.props(styles.count)}>{count}</span> : null}
    </button>
  );
}

const styles = stylex.create({
  layer: {
    display: "contents",
  },
  // Two wide, in the gutter past the prose or a wider block, below the row
  // above; hidden with a collapsed section.
  row: {
    position: "absolute",
    display: "grid",
    gridTemplateColumns: "repeat(2, max-content)",
    gap: "4px",
    positionAnchor: "var(--ask-pin-block)",
    anchorName: "var(--ask-pin-row)",
    top: "max(calc(anchor(top) + var(--ask-pin-offset)), calc(anchor(var(--ask-pin-above) bottom, -99999px) + 4px))",
    left: `calc(max(50% + min(100% - 2 * ${tokens.reviewDocumentPaddingInline}, ${tokens.reviewProseMaxWidth}) / 2, anchor(var(--ask-pin-lane) right)) + 10px)`,
    // A narrow document has little margin; the pins stay inside it rather
    // than making the page scroll sideways.
    positionTryFallbacks: "--ask-pin-inside",
    positionVisibility: "anchors-visible",
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
  count: {
    paddingRight: "2px",
  },
});
