import { fileURLToPath } from "node:url";

import type { Root } from "mdast";
import { visit } from "unist-util-visit";

const policies = new Set([
  fileURLToPath(new URL("../../../../docs/privacy.md", import.meta.url)),
  fileURLToPath(new URL("../../../../docs/telemetry.md", import.meta.url)),
]);

/** Keep canonical policy Markdown intact and site links portable under a base path. */
export default function docsLinks(options: { base: string }) {
  const base = `/${options.base.split("/").filter(Boolean).join("/")}`.replace(
    /\/$/,
    "",
  );

  return (tree: Root, file: { path: string }) => {
    const policy = policies.has(file.path);

    if (policy) {
      tree.children = tree.children.filter(
        (node) => node.type !== "heading" || node.depth !== 1,
      );
    }

    visit(tree, (node) => {
      if (
        node.type !== "link" &&
        node.type !== "definition" &&
        node.type !== "image"
      )
        return;

      if (policy) {
        node.url = node.url.replace(
          /^(privacy|telemetry)\.md(?=#|$)/,
          "/help/$1/",
        );
      }

      if (node.url.startsWith("/") && !node.url.startsWith("//")) {
        node.url = base + node.url;
      }
    });
  };
}
