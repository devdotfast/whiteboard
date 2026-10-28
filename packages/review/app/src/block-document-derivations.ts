import {
  type Block,
  canonicalLink,
  markdownNodes,
  parseMarkdown,
} from "@dev.fast/whiteboard-document";

import type { ReviewSectionSummary } from "./review-section-summary";

export function blockSectionSummary(children: Block[]): ReviewSectionSummary {
  const summary = { diagrams: 0, codeRefs: 0, paragraphs: 0 };

  const walk = (block: Block) => {
    switch (block.type) {
      case "section":
      case "callout":
        for (const child of block.children) walk(child);
        break;
      case "sequence":
      case "database_lens":
      case "call_stack_diff":
      case "flow_diagram":
      case "software_map":
      case "animation":
        summary.diagrams += 1;
        break;
      case "code_peek":
        summary.codeRefs += 1;
        break;
      case "markdown": {
        const markdown = parseMarkdown(block.markdown);

        for (const node of markdown.children ?? [])
          if (node.type === "paragraph") summary.paragraphs += 1;

        for (const node of markdownNodes(markdown))
          if (
            node.type === "link" &&
            canonicalLink(node.url ?? "").startsWith("whiteboard:source/")
          )
            summary.codeRefs += 1;
        break;
      }
    }
  };

  for (const child of children) walk(child);

  return summary;
}
