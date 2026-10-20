import { reviewSectionSummaryLabel } from "@canvas/review-components";
import type { ReviewTocEntry } from "@canvas/review-document-headings";
import type { ReviewSectionSummary } from "@canvas/review-section-summary";
import {
  headingAnchors,
  isBoardHeading,
  markdownHeadingDepth,
} from "@review/heading-anchors";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "@tiptap/pm/state";
import {
  AddMarkStep,
  AttrStep,
  RemoveMarkStep,
  ReplaceStep,
} from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { markdownHeadingLevel, nodes } from "./schema";
import { countLine } from "./summary";

// Headings on the page: a section's title, or a ## or ### inside a
// Markdown block, gets an anchor id, a Contents row and a collapse
// chevron, by the rule the server publishes anchors with. A collapsed heading hides what follows it up to the next
// heading at its level or above.

/** One line of the page: a top-level node, or a line of a Markdown block. */
interface Line {
  pos: number;
  node: PMNode;
  /** A heading's visual level, 1–3. */
  level?: number;
  /** The heading's collapse key: its section's id, or block and index. */
  key?: string;
  /** Sections deeper than this end before the line. */
  depth: number | null;
}

function lines(doc: PMNode): Line[] {
  const out: Line[] = [];

  doc.forEach((node, pos, index) => {
    if (index === 0) return;

    if (node.type === nodes.section)
      out.push({
        pos,
        node,
        level: Math.min(3, node.attrs.level),
        key: node.attrs.id ?? node.attrs.key ?? `at:${pos}`,
        depth: null,
      });
    else if (node.type === nodes.markdown) {
      let heading = 0;

      node.forEach((child, offset) => {
        const line: Line = {
          pos: pos + 1 + offset,
          node: child,
          depth: node.attrs.depth,
        };

        // ## and ### are the board's headings, as the server has them;
        // other levels read as text.
        if (child.type === nodes.heading && isBoardHeading(child.attrs.depth)) {
          line.level = markdownHeadingLevel(child.attrs.depth);
          line.key = `${node.attrs.id ?? node.attrs.key ?? `at:${pos}`}:${heading++}`;
        }

        out.push(line);
      });
    } else out.push({ pos, node, depth: node.attrs.depth });
  });

  return out;
}

export interface HeadingsState {
  collapsed: ReadonlySet<string>;
  entries: ReviewTocEntry[];
  decorations: DecorationSet;
}

export const headingsKey = new PluginKey<HeadingsState>("boardHeadings");

export interface HeadingsOptions {
  /** Whether a heading starts collapsed: as the reader left it, or as the
   * board says. */
  initiallyCollapsed(key: string): boolean;
  /** The reader collapsed or expanded a heading. */
  remember(key: string, collapsed: boolean): void;
}

/** A chevron says whether its heading is open; it stays the same element
 * as the heading collapses and expands. */
function label(button: HTMLElement, collapsed: boolean) {
  button.ariaExpanded = String(!collapsed);
  button.ariaLabel = `${collapsed ? "Expand" : "Collapse"} ${button.dataset.title || "heading"}`;
}

function chevron(
  view: EditorView,
  key: string,
  collapsed: boolean,
  title: string,
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "review-board-chevron";
  button.contentEditable = "false";
  button.dataset.heading = key;
  button.dataset.title = title;
  label(button, collapsed);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // The kit's ChevronDownIcon, which the CSS turns as DisclosureChevron does.
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", "M5 8.5 12 16l7-7.5");
  svg.append(path);
  button.append(svg);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => toggleHeading(view, key));

  return button;
}

function build(
  state: EditorState,
  collapsed: ReadonlySet<string>,
): Omit<HeadingsState, "collapsed"> {
  const found: Decoration[] = [];
  const entries: ReviewTocEntry[] = [];
  const anchor = headingAnchors();

  const open: {
    level: number;
    collapsed: boolean;
    summary?: ReviewSectionSummary;
  }[] = [];

  // A collapsed heading says what it hides, as a collapsed section does.
  const summaries: {
    at: number;
    key: string;
    summary: ReviewSectionSummary;
  }[] = [];

  // The depth of the section a line is in, for Contents.
  let sectionDepth = 0;
  /** The Markdown headings open under that section, by their `#` count. */
  let headingsOpen: number[] = [];

  for (const line of lines(state.doc)) {
    const end = line.pos + line.node.nodeSize;

    if (line.depth !== null && line.depth < sectionDepth) {
      sectionDepth = line.depth;
      headingsOpen = [];
    }

    while (
      open.length &&
      ((line.level !== undefined && open.at(-1)!.level >= line.level) ||
        (line.depth !== null && open.at(-1)!.level > line.depth))
    )
      open.pop();

    const hidden = open.some((heading) => heading.collapsed);

    for (const heading of open)
      if (heading.summary) countLine(heading.summary, line.node);

    if (hidden)
      found.push(
        Decoration.node(line.pos, end, {
          class: "review-board-hidden review-section--collapsed",
        }),
      );

    if (line.level === undefined || line.key === undefined) continue;
    const text = line.node.textContent;
    const id = anchor(text);
    const isCollapsed = collapsed.has(line.key);

    const summary = isCollapsed
      ? { diagrams: 0, codeRefs: 0, paragraphs: 0 }
      : undefined;

    open.push({ level: line.level, collapsed: isCollapsed, summary });

    if (summary && !hidden)
      summaries.push({ at: end - 1, key: line.key, summary });

    // A section sits at its level; a heading inside a Markdown block sits
    // one step under its section, and under the block's bigger headings
    // before it. An untitled section has no row, so it nests nothing.
    let depth: number = line.node.attrs.level;

    if (line.node.type === nodes.section) {
      if (text) {
        sectionDepth = depth;
        headingsOpen = [];
      }
    } else {
      const hashes: number = line.node.attrs.depth;

      depth = markdownHeadingDepth(headingsOpen, hashes, sectionDepth + 1);
    }

    if (text)
      entries.push({ id, text, level: depth === 1 ? "h2" : "h3", depth });
    found.push(
      Decoration.node(line.pos, end, {
        id,
        class: isCollapsed
          ? "review-board-heading review-board-heading-collapsed"
          : "review-board-heading",
      }),
      Decoration.widget(
        line.pos + 1,
        (view) => chevron(view, line.key!, isCollapsed, text),
        // A new widget when the heading's text changes.
        {
          side: -1,
          key: `${line.key}:${text}`,
          ignoreSelection: true,
        },
      ),
    );
  }

  for (const { at, key, summary } of summaries) {
    const label = reviewSectionSummaryLabel(summary);

    if (label)
      found.push(
        Decoration.widget(
          at,
          () => {
            const span = document.createElement("span");
            span.className = "review-board-summary";
            span.contentEditable = "false";
            span.textContent = label;

            return span;
          },
          { side: 1, key: `${key}:summary:${label}`, ignoreSelection: true },
        ),
      );
  }

  return { entries, decorations: DecorationSet.create(state.doc, found) };
}

const plainLine = (node: PMNode) =>
  node.isTextblock &&
  node.type !== nodes.section &&
  node.type !== nodes.heading;

function inOneLine(doc: PMNode, from: number, to: number) {
  const $from = doc.resolve(from);

  return $from.sameParent(doc.resolve(to)) && plainLine($from.parent);
}

/** Whether a transaction only edited text inside lines that aren't
 * headings, leaving every heading and the document's shape as they were.
 * A block's own attributes redraw it. */
export function textOnly(tr: Transaction) {
  if (tr.before.childCount !== tr.doc.childCount) return false;

  return tr.steps.every((step, index) => {
    const doc = tr.docs[index]!;

    if (step instanceof AttrStep)
      return (
        doc.resolve(step.pos).depth >= 1 &&
        doc.nodeAt(step.pos)?.type !== nodes.heading
      );

    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep)
      return inOneLine(doc, step.from, step.to);

    return (
      step instanceof ReplaceStep &&
      inOneLine(doc, step.from, step.to) &&
      step.slice.content.childCount <= 1 &&
      (step.slice.content.firstChild?.isInline ?? true)
    );
  });
}

export function toggleHeading(
  view: EditorView,
  key: string,
  collapsed?: boolean,
) {
  view.dispatch(view.state.tr.setMeta(headingsKey, { key, collapsed }));
}

/** Expand every collapsed heading above `pos`, so the line there shows. */
export function revealLine(view: EditorView, pos: number) {
  const state = headingsKey.getState(view.state);

  if (!state) return;
  const open: { level: number; key: string }[] = [];

  for (const line of lines(view.state.doc)) {
    if (line.pos > pos) break;

    while (
      open.length &&
      ((line.level !== undefined && open.at(-1)!.level >= line.level) ||
        (line.depth !== null && open.at(-1)!.level > line.depth))
    )
      open.pop();

    if (line.level !== undefined && line.key !== undefined && line.pos !== pos)
      open.push({ level: line.level, key: line.key });
  }

  for (const heading of open)
    if (state.collapsed.has(heading.key))
      toggleHeading(view, heading.key, false);
}

export const headings = (options: HeadingsOptions) =>
  new Plugin<HeadingsState>({
    key: headingsKey,
    state: {
      init(_config, state) {
        const collapsed = new Set(
          lines(state.doc).flatMap((line) =>
            line.key !== undefined && options.initiallyCollapsed(line.key)
              ? [line.key]
              : [],
          ),
        );

        return { collapsed, ...build(state, collapsed) };
      },
      apply(tr, value, _old, state) {
        const meta: { key: string; collapsed?: boolean } | undefined =
          tr.getMeta(headingsKey);

        if (!meta && !tr.docChanged) return value;
        let collapsed = value.collapsed;

        if (meta) {
          const next = meta.collapsed ?? !collapsed.has(meta.key);
          const changed = new Set(collapsed);

          if (next) changed.add(meta.key);
          else changed.delete(meta.key);
          collapsed = changed;
          options.remember(meta.key, next);
        }

        // Typing inside an ordinary line moves headings but changes none.
        if (!meta && textOnly(tr))
          return {
            ...value,
            decorations: value.decorations.map(tr.mapping, tr.doc),
          };

        return { collapsed, ...build(state, collapsed) };
      },
    },
    props: {
      decorations: (state) => headingsKey.getState(state)?.decorations,
    },
    view: () => ({
      update(view, previous) {
        const { collapsed } = headingsKey.getState(view.state)!;

        if (collapsed === headingsKey.getState(previous)?.collapsed) return;

        for (const button of view.dom.querySelectorAll<HTMLElement>(
          ".review-board-chevron",
        ))
          label(button, collapsed.has(button.dataset.heading!));
      },
    }),
  });
