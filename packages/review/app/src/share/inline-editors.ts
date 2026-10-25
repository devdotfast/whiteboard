import {
  normalizeMarkdownCodeLanguage,
  syntaxByToken,
} from "@canvas/code-block";
import { codeType } from "@canvas/document-type.stylex";
import { fontSize, leading, radius, space } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import type {
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

interface Piece {
  text: string;
  token?: ShjToken;
}

interface Row {
  n: number;
  text?: string;
  pieces?: Piece[];
}

interface Block {
  side: ReviewDiffSide;
  rows: Row[];
}

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

/** Each range read at its own side; a range reading the same as one on the
 * other side is shown once. */
function rangeBlocks(
  excerpt: Excerpt,
  boardPins: ReviewSourcePins | undefined,
  spec: Spec,
) {
  const pins = spec.pins ?? boardPins;
  const blocks: Block[] = [];
  const shown = new Map<string, ReviewDiffSide>();

  for (const range of spec.ranges) {
    const side = range.side ?? spec.side;
    const commit = side === "base" ? (pins?.base ?? pins?.head) : pins?.head;
    const rows: Row[] = [];

    for (let n = Math.max(1, range.startLine); n <= range.endLine; n++)
      rows.push({ n, ...(commit && excerpt(spec.path, commit, n)) });

    const key = JSON.stringify(rows.map((row) => row.text ?? null));
    const seen = shown.get(key);

    if (seen && seen !== side) continue;
    shown.set(key, side);
    blocks.push({ side, rows });
  }

  return blocks;
}

const lineKey = (block: number, line: number) => `${block}:${line}`;

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
    for (const { n, text } of block.rows) {
      const matches: Match[] = [];

      for (const match of text?.matchAll(regex) ?? [])
        if (match[0])
          matches.push({
            start: match.index,
            end: match.index + match[0].length,
            index: count++,
          });

      if (matches.length) byLine.set(lineKey(index, n), matches);
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

function rangeHtml(
  { side, rows }: Block,
  index: number,
  labelled: boolean,
  found: Found,
) {
  let inner =
    labelled && side === "base" ? element("div", styles.notice, "Base") : "";

  for (const [at, { n, text, pieces }] of rows.entries()) {
    if (text === undefined) {
      if (rows[at - 1]?.text !== undefined || at === 0)
        inner += element(
          "div",
          styles.notice,
          UNAVAILABLE,
          " data-unavailable",
        );

      continue;
    }

    inner += element(
      "div",
      styles.line,
      element("span", styles.gutter, String(n)) +
        code(
          text,
          pieces,
          found.byLine.get(lineKey(index, n)) ?? [],
          found.active,
        ),
      ` data-line="${n}"`,
    );
  }

  return element("div", styles.range, inner, ` data-range data-side="${side}"`);
}

function peekClass(heightMode: string, collapsed: boolean) {
  return className([
    styles.peek,
    heightMode === "capped" && styles.capped,
    collapsed && styles.collapsed,
  ]);
}

function peekInner(title: string, blocks: readonly Block[], found: Found) {
  const labelled = new Set(blocks.map((block) => block.side)).size > 1;

  const body = blocks.length
    ? blocks
        .map((block, index) => rangeHtml(block, index, labelled, found))
        .join("")
    : element("div", styles.notice, UNAVAILABLE, " data-unavailable");

  return (
    element("div", styles.header, escape(title)) +
    element("div", styles.body, body)
  );
}

/** Read-only peeks of the lines a share carries. */
export async function shareInlineEditors(
  sources: readonly ShareSource[],
  boardPins: ReviewSourcePins | undefined,
): Promise<ReviewInlineEditorFactory> {
  const excerpt = await excerpts(sources);

  const markup = (spec: ReviewInlineStaticSpec) =>
    `<div class="${peekClass(spec.heightMode, false)}">${peekInner(spec.title, rangeBlocks(excerpt, boardPins, spec), find([], undefined))}</div>`;

  return {
    async find(spec, query) {
      return {
        matchCount: find(rangeBlocks(excerpt, boardPins, spec), matcher(query))
          .count,
      };
    },
    renderStatic: markup,
    create(spec) {
      const blocks = rangeBlocks(excerpt, boardPins, spec);
      const listeners = new Set<(height: number) => void>();
      let found = find([], undefined);
      let collapsed = false;

      const peek = document.createElement("div");

      const render = () => {
        peek.className = peekClass(spec.heightMode, collapsed);
        peek.innerHTML = peekInner(spec.title, blocks, found);
      };

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
          peek.scrollTop =
            mark.offsetTop - (peek.clientHeight - mark.offsetHeight) / 2;
          peek.scrollLeft =
            mark.offsetLeft - (peek.clientWidth - mark.offsetWidth) / 2;
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
          observer.disconnect();
          listeners.clear();
          peek.remove();
        },
      };
    },
  };
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
    whiteSpace: "pre",
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
