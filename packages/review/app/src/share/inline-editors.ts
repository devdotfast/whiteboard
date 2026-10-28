import {
  normalizeMarkdownCodeLanguage,
  syntaxByToken,
} from "@canvas/code-block";
import { codeType } from "@canvas/document-type.stylex";
import { fontSize, leading, radius, space } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { focusStyles } from "@canvas/ui/focus";
import type {
  ReviewCanvasBridge,
  ReviewDiffSide,
  ReviewFindQuery,
  ReviewInlineEditorFactory,
  ReviewInlineFindSpec,
  ReviewInlineStaticSpec,
  ReviewSourcePins,
} from "@dev.fast/review-protocol";
import type { ShareSource } from "@dev.fast/review-share-protocol";
import { type ShjToken, tokenize } from "@speed-highlight/core";
import * as stylex from "@stylexjs/stylex";
import { diffArrays } from "diff";

interface Piece {
  text: string;
  token?: ShjToken;
}

interface Row {
  n: number;
  text?: string;
  pieces?: Piece[];
  change?: "added" | "removed";
  /** The base line an unchanged row of a diff reads at. */
  base?: number;
}

interface Block {
  side: ReviewDiffSide;
  rows: Row[];
  diff?: boolean;
}

/** What the reader chose in Diff settings. */
export type PeekSettings = Pick<
  ReviewCanvasBridge,
  | "currentDiffLayout"
  | "onDidChangeDiffLayout"
  | "currentInlineLineNumbers"
  | "onDidChangeInlineLineNumbers"
>;

interface Match {
  start: number;
  end: number;
  index: number;
}

interface Found {
  byLine: Map<string, Match[]>;
  count: number;
  active?: number;
}

type Spec = Pick<ReviewInlineFindSpec, "path" | "side" | "pins" | "ranges">;

type Excerpt = (
  file: string,
  commit: string,
  line: number,
) => Pick<Row, "text" | "pieces">;

const UNAVAILABLE = "Code unavailable in this share";

/** Tokens for each of `lines`, or undefined for a language it cannot read. */
async function highlight(path: string, lines: readonly string[]) {
  const language = normalizeMarkdownCodeLanguage(
    path.slice(path.lastIndexOf(".") + 1),
  );

  if (!language) return;
  const rows: Piece[][] = [[]];

  await tokenize(lines.join("\n"), language, (text, token) => {
    for (const [index, part] of text.split("\n").entries()) {
      if (index) rows.push([]);

      if (part) rows.at(-1)!.push({ text: part, token });
    }
  });

  return rows;
}

/** Each excerpt's lines, highlighted once up front so a server render and
 * the page that hydrates it show the same markup. */
async function excerpts(sources: readonly ShareSource[]): Promise<Excerpt> {
  const files = new Map<string, Map<number, Pick<Row, "text" | "pieces">>>();

  await Promise.all(
    sources.map(async (source) => {
      const key = `${source.commit}\0${source.file}`;
      const lines = files.get(key) ?? new Map();
      files.set(key, lines);

      const pieces = await highlight(source.file, source.lines).catch(
        () => undefined,
      );

      for (const [index, text] of source.lines.entries())
        lines.set(source.fromLine + index, { text, pieces: pieces?.[index] });
    }),
  );

  return (file, commit, line) =>
    files.get(`${commit}\0${file}`)?.get(line) ?? {};
}

/** The head's lines with the base's removed lines between them, as the
 * Desktop's unified peek shows them. */
function unified(base: Block, head: Block): Block[] {
  if (![...base.rows, ...head.rows].every((row) => row.text !== undefined))
    return [base, head];

  const rows: Row[] = [];
  let [b, h] = [0, 0];

  for (const part of diffArrays(
    base.rows.map((row) => row.text),
    head.rows.map((row) => row.text),
  ))
    for (let i = 0; i < part.value.length; i++)
      if (part.removed) rows.push({ ...base.rows[b++], change: "removed" });
      else if (part.added) rows.push({ ...head.rows[h++], change: "added" });
      else rows.push({ ...head.rows[h++], base: base.rows[b++].n });

  return [{ side: "head", rows, diff: true }];
}

/** Each range read at its own side. A selection resolves to a base range and
 * a head range, which read as one diff. */
function rangeBlocks(
  excerpt: Excerpt,
  boardPins: ReviewSourcePins | undefined,
  spec: Spec,
) {
  const pins = spec.pins ?? boardPins;
  const sides: Record<ReviewDiffSide, Block[]> = { base: [], head: [] };

  for (const range of spec.ranges) {
    const side = range.side ?? spec.side;
    const commit = side === "base" ? (pins?.base ?? pins?.head) : pins?.head;
    const rows: Row[] = [];

    for (let n = Math.max(1, range.startLine); n <= range.endLine; n++)
      rows.push({ n, ...(commit && excerpt(spec.path, commit, n)) });

    sides[side].push({ side, rows });
  }

  const { base, head } = sides;

  return [
    ...head.flatMap((block, k) => (base[k] ? unified(base[k], block) : block)),
    ...base.slice(head.length),
  ];
}

const lineKey = (block: number, row: number) => `${block}:${row}`;

function matcher(query: ReviewFindQuery) {
  if (!query.text) return;

  const pattern = query.isRegex
    ? query.text
    : query.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  try {
    return new RegExp(
      query.wholeWord ? `\\b(?:${pattern})\\b` : pattern,
      query.matchCase ? "g" : "gi",
    );
  } catch {
    return;
  }
}

function find(blocks: readonly Block[], regex: RegExp | undefined): Found {
  const byLine = new Map<string, Match[]>();
  let count = 0;

  if (!regex) return { byLine, count };

  for (const [index, block] of blocks.entries())
    for (const [at, { text }] of block.rows.entries()) {
      const matches: Match[] = [];

      for (const match of text?.matchAll(regex) ?? [])
        if (match[0])
          matches.push({
            start: match.index,
            end: match.index + match[0].length,
            index: count++,
          });

      if (matches.length) byLine.set(lineKey(index, at), matches);
    }

  return { byLine, count };
}

// Excerpts are untrusted: every text and attribute goes through here.
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const className = (style: stylex.StyleXStyles) =>
  escape(stylex.props(style).className ?? "");

function element(
  tag: string,
  style: stylex.StyleXStyles | false,
  inner = "",
  attributes = "",
) {
  const name = style ? className(style) : "";

  return `<${tag}${name ? ` class="${name}"` : ""}${attributes}>${inner}</${tag}>`;
}

function code(
  line: string,
  pieces: readonly Piece[] | undefined,
  matches: readonly Match[],
  active: number | undefined,
) {
  const list = pieces?.length ? pieces : [{ text: line }];
  const starts: number[] = [];
  let offset = 0;

  for (const piece of list) {
    starts.push(offset);
    offset += piece.text.length;
  }

  const cuts = [
    ...new Set([
      0,
      line.length,
      ...starts,
      ...matches.flatMap((match) => [match.start, match.end]),
    ]),
  ].sort((a, b) => a - b);

  let inner = "";

  for (let i = 0; i < cuts.length - 1; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]];

    if (from >= to || from >= line.length) continue;
    const { token } = list[starts.findLastIndex((start) => start <= from)];

    const piece = element(
      "span",
      (token && syntaxByToken.get(token)) ?? false,
      escape(line.slice(from, to)),
    );

    const match = matches.find(
      (candidate) => candidate.start <= from && to <= candidate.end,
    );

    inner += match
      ? element(
          "mark",
          [styles.match, match.index === active && styles.activeMatch],
          piece,
          ` data-match="${match.index}"${match.index === active ? " data-active" : ""}`,
        )
      : piece;
  }

  return element("span", styles.code, inner);
}

function lineHtml(
  row: Row,
  matches: readonly Match[],
  found: Found,
  settings: PeekSettings,
  n = row.n,
) {
  const { change } = row;
  const numbered = settings.currentInlineLineNumbers();

  return element(
    "div",
    [styles.line, !numbered && styles.bare, change && styles[change]],
    (numbered ? element("span", styles.gutter, String(n)) : "") +
      code(row.text ?? "", row.pieces, matches, found.active),
    ` data-line="${n}"${change ? ` data-change="${change}"` : ""}`,
  );
}

/** A diff's rows as base and head columns: each change's removed lines
 * beside its added ones, the shorter side filled. */
function splitHtml(
  { rows }: Block,
  index: number,
  found: Found,
  settings: PeekSettings,
) {
  const filler = element(
    "div",
    [styles.line, styles.filler],
    "",
    " data-filler",
  );

  const columns = { base: "", head: "" };
  let removed: string[] = [];
  let added: string[] = [];

  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      columns.base += removed[i] ?? filler;
      columns.head += added[i] ?? filler;
    }

    [removed, added] = [[], []];
  };

  for (const [at, row] of rows.entries()) {
    const line = lineHtml(
      row,
      found.byLine.get(lineKey(index, at)) ?? [],
      found,
      settings,
    );

    if (row.change === "removed") removed.push(line);
    else if (row.change === "added") added.push(line);
    else {
      flush();
      // An unchanged row's matches count once, on its head side.
      columns.base += lineHtml(row, [], found, settings, row.base ?? row.n);
      columns.head += line;
    }
  }

  flush();

  return element(
    "div",
    [styles.range, styles.split],
    Object.entries(columns)
      .map(([side, inner]) =>
        element("div", styles.column, inner, ` data-column="${side}"`),
      )
      .join(""),
    ' data-range data-side="head"',
  );
}

function rangeHtml(
  block: Block,
  index: number,
  labelled: boolean,
  found: Found,
  settings: PeekSettings,
) {
  if (block.diff && settings.currentDiffLayout("peek") === "split")
    return splitHtml(block, index, found, settings);

  const { side, rows } = block;

  let inner =
    labelled && side === "base" ? element("div", styles.notice, "Base") : "";

  for (const [at, row] of rows.entries()) {
    if (row.text === undefined) {
      if (rows[at - 1]?.text !== undefined || at === 0)
        inner += element(
          "div",
          styles.notice,
          UNAVAILABLE,
          " data-unavailable",
        );

      continue;
    }

    inner += lineHtml(
      row,
      found.byLine.get(lineKey(index, at)) ?? [],
      found,
      settings,
    );
  }

  return element("div", styles.range, inner, ` data-range data-side="${side}"`);
}

function peekClass(heightMode: string, collapsed: boolean) {
  return className([
    focusStyles.ringInset,
    styles.peek,
    heightMode === "capped" && styles.capped,
    collapsed && styles.collapsed,
  ]);
}

function peekInner(
  title: string,
  blocks: readonly Block[],
  found: Found,
  settings: PeekSettings,
) {
  const labelled = new Set(blocks.map((block) => block.side)).size > 1;

  const body = blocks.length
    ? blocks
        .map((block, index) =>
          rangeHtml(block, index, labelled, found, settings),
        )
        .join("")
    : element("div", styles.notice, UNAVAILABLE, " data-unavailable");

  return (
    element("div", styles.header, escape(title)) +
    element("div", styles.body, body)
  );
}

/** Read-only peeks of the lines a share carries, laid out as the reader's
 * Diff settings say. */
export async function shareInlineEditors(
  sources: readonly ShareSource[],
  boardPins: ReviewSourcePins | undefined,
): Promise<(settings: PeekSettings) => ReviewInlineEditorFactory> {
  return excerptEditors(await excerpts(sources), boardPins);
}

/** Peeks with no lines to show: each says its source is unavailable. */
export const sourcelessEditors = (settings: PeekSettings) =>
  excerptEditors(() => ({}), undefined)(settings);

function excerptEditors(
  excerpt: Excerpt,
  boardPins: ReviewSourcePins | undefined,
): (settings: PeekSettings) => ReviewInlineEditorFactory {
  return (settings) => ({
    async find(spec, query) {
      return {
        matchCount: find(rangeBlocks(excerpt, boardPins, spec), matcher(query))
          .count,
      };
    },
    renderStatic: (spec: ReviewInlineStaticSpec) =>
      `<div class="${peekClass(spec.heightMode, false)}">${peekInner(spec.title, rangeBlocks(excerpt, boardPins, spec), find([], undefined), settings)}</div>`,
    create(spec) {
      const blocks = rangeBlocks(excerpt, boardPins, spec);
      const listeners = new Set<(height: number) => void>();
      let found = find([], undefined);
      let collapsed = false;

      // Focusable, so a click gives it the wheel as a Desktop editor's does.
      const peek = document.createElement("div");
      peek.tabIndex = 0;
      peek.addEventListener("focusin", () => spec.onDidFocus?.());

      const render = () => {
        peek.className = peekClass(spec.heightMode, collapsed);
        peek.innerHTML = peekInner(spec.title, blocks, found, settings);
      };

      const subscriptions = [
        settings.onDidChangeDiffLayout("peek", render),
        settings.onDidChangeInlineLineNumbers(render),
      ];

      // Replaces a server render's markup with the same HTML, so nothing
      // moves.
      render();
      spec.container.replaceChildren(peek);

      let height = peek.offsetHeight;

      const observer = new ResizeObserver(() => {
        if (peek.offsetHeight === height) return;
        height = peek.offsetHeight;

        for (const listener of listeners) listener(height);
      });

      observer.observe(peek);

      return {
        get height() {
          return height;
        },
        setActive() {},
        setCollapsed(next) {
          collapsed = next;
          render();
        },
        onDidChangeHeight(listener) {
          listeners.add(listener);

          return { dispose: () => listeners.delete(listener) };
        },
        onDidError: () => ({ dispose() {} }),
        async setFindQuery(query) {
          found = find(blocks, matcher(query));
          render();

          return { matchCount: found.count };
        },
        revealFindMatch(index) {
          found = { ...found, active: index };
          render();

          const mark = peek.querySelector<HTMLElement>(
            `mark[data-match="${index}"]`,
          );

          if (!mark) return;
          const at = mark.getBoundingClientRect();
          const across = mark.closest<HTMLElement>("[data-column]") ?? peek;
          peek.scrollTop +=
            at.top -
            peek.getBoundingClientRect().top -
            (peek.clientHeight - at.height) / 2;
          across.scrollLeft +=
            at.left -
            across.getBoundingClientRect().left -
            (across.clientWidth - at.width) / 2;
        },
        clearActiveFindMatch() {
          found = { ...found, active: undefined };
          render();
        },
        clearFind() {
          found = find([], undefined);
          render();
        },
        dispose() {
          for (const subscription of subscriptions) subscription.dispose();
          observer.disconnect();
          listeners.clear();
          peek.remove();
        },
      };
    },
  });
}

const styles = stylex.create({
  peek: {
    overflow: "auto",
    backgroundColor: tokens.bg,
    color: tokens.ink,
    font: `${codeType.size}/${codeType.leading} ${tokens.fontCode}`,
    fontVariantLigatures: codeType.ligatures,
    tabSize: 4,
  },
  // As many lines as an editor peek shows, under its header.
  capped: {
    maxHeight: "400px",
  },
  collapsed: {
    display: "none",
  },
  header: {
    position: "sticky",
    top: 0,
    left: 0,
    padding: `${space.s10} ${space.s12}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
    backgroundColor: tokens.bg,
    color: tokens.inkMuted,
    font: `${fontSize.small}/${leading.px20} ${tokens.chromeFont}`,
  },
  body: {
    paddingBlock: space.s6,
  },
  range: {
    borderTopWidth: {
      default: "1px",
      ":first-child": "0",
    },
    borderTopStyle: "dashed",
    borderTopColor: tokens.ruleSoft,
  },
  line: {
    display: "flex",
    width: "max-content",
    minWidth: "100%",
    minHeight: "1lh",
    whiteSpace: "pre",
  },
  bare: {
    paddingInlineStart: space.s12,
  },
  split: {
    display: "flex",
  },
  column: {
    flex: "1 1 0",
    minWidth: 0,
    overflowX: "auto",
    borderRightWidth: { default: "1px", ":last-child": "0" },
    borderRightStyle: "solid",
    borderRightColor: tokens.ruleSoft,
  },
  filler: {
    backgroundColor: `color-mix(in srgb, ${tokens.ruleSoft} 35%, ${tokens.transparent})`,
  },
  added: {
    backgroundColor: tokens.diffAddedBg,
  },
  removed: {
    backgroundColor: tokens.diffRemovedBg,
  },
  gutter: {
    flexShrink: 0,
    minWidth: "4ch",
    paddingInline: `${space.s8} ${space.s12}`,
    color: tokens.ghost,
    textAlign: "right",
    userSelect: "none",
  },
  code: {
    paddingInlineEnd: space.s12,
  },
  match: {
    borderRadius: radius.hairline,
    backgroundColor: tokens.reviewFindMatchBackground,
    color: "inherit",
  },
  activeMatch: {
    backgroundColor: tokens.reviewFindMatchActiveBackground,
  },
  notice: {
    paddingInline: space.s12,
    color: tokens.inkFaint,
    font: `${fontSize.small}/${leading.px20} ${tokens.chromeFont}`,
  },
});
