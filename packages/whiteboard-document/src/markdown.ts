import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { gfm } from "micromark-extension-gfm";
import { math } from "micromark-extension-math";

import { latexMath, latexMathFromMarkdown } from "./markdown-latex-math";

export interface MarkdownNode {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MarkdownNode[];
  value?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  checked?: boolean | null;
  lang?: string | null;
  url?: string;
  title?: string | null;
  align?: Array<string | null> | null;
  alt?: string | null;
  identifier?: string;
  label?: string | null;
}

export function* markdownNodes(node: MarkdownNode): Generator<MarkdownNode> {
  yield node;

  for (const child of node.children ?? []) yield* markdownNodes(child);
}

/** The text a node carries, its own and every descendant's. */
export function markdownText(node: MarkdownNode): string {
  return [...markdownNodes(node)].map((child) => child.value ?? "").join("");
}

/** Link destination spans in source order; never inside code. */
export function linkDestinations(
  nodes: Iterable<MarkdownNode>,
): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];

  for (const node of nodes) {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;

    if (from === undefined || to === undefined) continue;

    if (node.type === "link")
      spans.push({
        from: node.children?.at(-1)?.position?.end.offset ?? from + 1,
        to,
      });
    else if (node.type === "image" || node.type === "definition")
      spans.push({ from, to });
  }

  // An image inside a link comes after the link's tail in the walk.
  return spans.toSorted((a, b) => a.from - b.from);
}

export function rewriteLinkDestinations(
  markdown: string,
  rewrite: (span: string) => string,
): string {
  let result = markdown;

  for (const { from, to } of linkDestinations(
    markdownNodes(parseMarkdown(markdown)),
  ).toReversed())
    result =
      result.slice(0, from) +
      rewrite(result.slice(from, to)) +
      result.slice(to);

  return result;
}

/** Shared syntax for submit-time source checks and safe Markdown rendering. */
export function parseMarkdown(source: string): MarkdownNode {
  const tree: MarkdownNode = fromMarkdown(source, {
    extensions: [gfm(), math(), latexMath()],
    mdastExtensions: [
      gfmFromMarkdown(),
      mathFromMarkdown(),
      latexMathFromMarkdown(),
    ],
  });

  // `$$x$$` alone in its paragraph is a display equation written on one line.
  for (const node of markdownNodes(tree)) {
    const [only, ...others] = node.children ?? [];

    if (
      node.type === "paragraph" &&
      only?.type === "inlineMath" &&
      others.length === 0 &&
      source.startsWith("$$", only.position?.start.offset)
    )
      only.type = "math";
  }

  const definitions = new Map<string, MarkdownNode>();

  for (const node of markdownNodes(tree))
    if (node.type === "definition" && !definitions.has(node.identifier!))
      definitions.set(node.identifier!, node);

  for (const node of markdownNodes(tree)) {
    if (node.type !== "linkReference") continue;
    const definition = definitions.get(node.identifier!);

    if (definition)
      Object.assign(node, {
        type: "link",
        url: definition.url,
        title: definition.title,
      });
  }

  return tree;
}
