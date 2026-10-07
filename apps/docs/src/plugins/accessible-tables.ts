import type { Root } from "hast";
import { visit } from "unist-util-visit";

/** Starlight tables scroll horizontally on narrow screens. Enable keyboard access. */
export default function accessibleTables() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (node.tagName === "table") node.properties.tabIndex = 0;
    });
  };
}
