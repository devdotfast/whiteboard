import type { ReviewSectionSummary } from "@canvas/review-section-summary";
import { canonicalLink } from "@review/review-api/document";
import type { Mark, Node as PMNode } from "@tiptap/pm/model";

import { nodes } from "./schema";

// What a collapsed heading hides, counted as a collapsed section counts
// its children: diagrams, code references, and paragraphs.

const diagrams = new Set([
  "sequence",
  "database_lens",
  "call_stack_diff",
  "flow_diagram",
  "software_map",
]);

/** Add one hidden line to `summary`. */
export function countLine(summary: ReviewSectionSummary, line: PMNode) {
  if (line.type === nodes.atom) {
    const type = line.attrs.json.type;

    if (diagrams.has(type)) summary.diagrams += 1;
    else if (type === "code_peek") summary.codeRefs += 1;

    return;
  }

  if (line.type === nodes.paragraph) summary.paragraphs += 1;

  const links = (textblock: PMNode) => {
    // A link split by other marks is still one link.
    let previous: Mark | undefined;

    textblock.forEach((inline) => {
      const link = inline.marks.find((mark) => mark.type.name === "link");

      if (
        link &&
        !(previous && link.eq(previous)) &&
        canonicalLink(link.attrs.href).startsWith("whiteboard:source/")
      )
        summary.codeRefs += 1;
      previous = link;
    });
  };

  if (line.isTextblock) links(line);
  else
    line.descendants((node) => {
      if (node.isTextblock) links(node);

      return !node.isTextblock;
    });
}
