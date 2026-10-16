import {
  headingAnchors,
  isBoardHeading,
  markdownHeadingDepth,
} from "@review/heading-anchors.js";
import { markdownText, parseMarkdown } from "@review/markdown.js";

import type { Block } from "./document.js";

export type ReviewHeadingLevel = "h2" | "h3";

/** A section title or a root-level h2/h3 of a markdown block. `block` rather
 * than its id: import needs slugs before the store has assigned ids. */
export interface DocumentHeading {
  id: string;
  text: string;
  level: ReviewHeadingLevel;
  block: Block;
  /** Position among the markdown block's own headings; absent for a section. */
  index?: number;
  /** How deep it sits, 1 at the top: a section by its nesting, a Markdown
   * heading one step under its section and under the block's bigger
   * headings before it. */
  depth: number;
}

/** Heading ids by the rule the MDX renderer published, `slugify(text)` made
 * unique in document order, so imported `#fragment` links still land. */
export function documentHeadings(blocks: Block[]): DocumentHeading[] {
  const anchor = headingAnchors();
  const out: DocumentHeading[] = [];

  const assign = (heading: Omit<DocumentHeading, "id">) => {
    out.push({ id: anchor(heading.text), ...heading });
  };

  /** The Markdown headings open under the current section, by `#` count. */
  let open: number[] = [];

  const visit = (list: Block[], depth: number) => {
    for (const block of list) {
      if (block.type === "section") {
        assign({
          text: block.title,
          level: depth === 1 ? "h2" : "h3",
          block,
          depth,
        });
        open = [];
        visit(block.children, depth + 1);
        open = [];
        continue;
      }

      if (block.type === "markdown") {
        let index = 0;

        for (const node of parseMarkdown(block.markdown).children ?? []) {
          if (node.type !== "heading" || !isBoardHeading(node.depth)) continue;

          const at = markdownHeadingDepth(open, node.depth!, depth);

          assign({
            text: markdownText(node),
            level: node.depth === 2 ? "h2" : "h3",
            block,
            index: index++,
            depth: at,
          });
        }

        continue;
      }

      if ("children" in block) visit(block.children, depth);
    }
  };

  visit(blocks, 1);

  return out;
}
