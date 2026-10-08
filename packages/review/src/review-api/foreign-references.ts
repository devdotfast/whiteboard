import path from "node:path";

import { type JsonValue, isJsonObject, isStringValue } from "@dev.fast/json";
import { parseAnchor } from "@review/lens-selection.js";
import {
  markdownNodes,
  markdownText,
  parseMarkdown,
} from "@review/markdown.js";

/** A file's text at a commit; undefined when it can't be read. */
export type ReadAtCommit = (
  repositoryId: string,
  commit: string,
  file: string,
) => string | undefined;

const LANGUAGES = new Map([
  [".ts", "typescript"],
  [".tsx", "tsx"],
  [".js", "javascript"],
  [".jsx", "jsx"],
  [".mjs", "javascript"],
  [".rs", "rust"],
  [".go", "go"],
  [".py", "python"],
  [".rb", "ruby"],
  [".java", "java"],
  [".kt", "kotlin"],
  [".swift", "swift"],
  [".c", "c"],
  [".h", "c"],
  [".cc", "cpp"],
  [".cpp", "cpp"],
  [".css", "css"],
  [".html", "html"],
  [".json", "json"],
  [".md", "markdown"],
  [".sh", "bash"],
  [".sql", "sql"],
  [".toml", "toml"],
  [".yaml", "yaml"],
  [".yml", "yaml"],
]);

/** A source link in Markdown, in either spelling. */
const SOURCE_LINK = /^(?:whiteboard:source\/|review-source:)/i;

/**
 * Migrates the old global scratchpad, which quoted several repositories.
 * A board may only quote its own, so each quote of another repository is
 * replaced:
 * - a code peek becomes a `code` block of those lines;
 * - a source link becomes its text, then what it pointed at in code;
 * - a diagram attachment leaves the diagram and its lines follow it as
 *   a `code` block;
 * - a step keeps its label and takes the lines as its code;
 * - a call stack or database lens becomes a line saying what it was,
 *   then a `code` block for each range it quoted, in any repository; the
 *   first takes its id. A lens that quotes only its own repository is
 *   kept.
 * New blocks take ids from `allocate`.
 */
export function snapshotForeignReferences(
  document: JsonValue[],
  own: string,
  read: ReadAtCommit,
  repositoryName: (repositoryId: string) => string,
  allocate: (prefix: string) => string,
): JsonValue[] {
  const foreign = (pins: JsonValue | undefined) =>
    isJsonObject(pins) &&
    isStringValue(pins.repositoryId) &&
    pins.repositoryId !== own
      ? pins
      : undefined;

  const caption = (
    pins: { repositoryId: string; head: string; base?: string },
    anchor: string,
  ) => {
    const selection = parseAnchor(anchor);

    const commit =
      selection?.start.side === "base" ? (pins.base ?? pins.head) : pins.head;

    const range = selection
      ? `${selection.file}:${selection.start.line}-${selection.end.line}`
      : anchor;

    return `${repositoryName(pins.repositoryId)} · ${range} @ ${commit.slice(0, 7)}`;
  };

  const snapshot = (
    id: JsonValue | undefined,
    pins: { repositoryId: string; head: string; base?: string },
    anchor: string,
  ): JsonValue => {
    const selection = parseAnchor(anchor);

    const commit =
      selection?.start.side === "base" ? (pins.base ?? pins.head) : pins.head;

    const file = selection
      ? read(pins.repositoryId, commit, selection.file)
      : undefined;

    const label = caption(pins, anchor);

    const text =
      file !== undefined && selection
        ? file
            .split("\n")
            .slice(selection.start.line - 1, selection.end.line)
            .join("\n")
        : `${label}\n(source unavailable)`;

    return {
      type: "code",
      ...(isStringValue(id) && { id }),
      language: selection
        ? (LANGUAGES.get(path.extname(selection.file).toLowerCase()) ?? "text")
        : "text",
      text,
      caption: label,
    };
  };

  const pinsIn = (pins: JsonValue | undefined) => {
    return isJsonObject(pins) &&
      isStringValue(pins.repositoryId) &&
      isStringValue(pins.head)
      ? {
          repositoryId: pins.repositoryId,
          head: pins.head,
          ...(isStringValue(pins.base) && { base: pins.base }),
        }
      : undefined;
  };

  const pinsOf = (value: JsonValue | undefined) => pinsIn(foreign(value));

  const peeks = (blocks: JsonValue[]): JsonValue[] =>
    blocks.map((block) => {
      if (!isJsonObject(block)) return block;

      if (Array.isArray(block.children))
        return { ...block, children: peeks(block.children) };

      const pins = pinsOf(block.pins);

      if (block.type === "code_peek" && pins && isStringValue(block.source))
        return snapshot(block.id, pins, block.source);

      return block;
    });

  const rest = (blocks: JsonValue[]): JsonValue[] =>
    blocks.flatMap((block): JsonValue | JsonValue[] => {
      if (!isJsonObject(block)) return block;

      if (Array.isArray(block.children))
        return { ...block, children: rest(block.children) };

      const blockPins = pinsOf(block.pins);

      if (
        block.type === "markdown" &&
        blockPins &&
        isStringValue(block.markdown)
      ) {
        const { pins: _pins, ...kept } = block;

        return {
          ...kept,
          markdown: unlinkSourceLinks(block.markdown, blockPins),
        };
      }

      if (block.type === "sequence" && Array.isArray(block.steps))
        return {
          ...block,
          steps: block.steps.map((step) => {
            if (!isJsonObject(step) || !isStringValue(step.source)) return step;
            const pins = pinsOf(step.pins ?? block.pins);

            if (!pins) return step;
            const { source, pins: _pins, ...kept } = step;
            const quoted = snapshot(undefined, pins, source);

            return isJsonObject(quoted)
              ? {
                  ...kept,
                  code: { language: quoted.language, text: quoted.text },
                }
              : kept;
          }),
        };

      if (block.type === "flow_diagram" && Array.isArray(block.nodes)) {
        const moved: JsonValue[] = [];

        const diagram = {
          ...block,
          nodes: block.nodes.map((node) =>
            isJsonObject(node) && Array.isArray(node.attachments)
              ? {
                  ...node,
                  attachments: node.attachments.filter((attachment) => {
                    if (
                      !isJsonObject(attachment) ||
                      !pinsOf(attachment.pins ?? block.pins)
                    )
                      return true;

                    // Its lines stay on the board, after the diagram.
                    for (const [pins, anchor] of quotes(
                      attachment,
                      pinsIn,
                      block.pins,
                    ))
                      moved.push(snapshot(allocate("block"), pins, anchor));

                    return false;
                  }),
                }
              : node,
          ),
        };

        return [diagram, ...moved];
      }

      if (block.type === "call_stack_diff" || block.type === "database_lens") {
        const foreignQuote = quotes(block, pinsOf)[0];

        if (!foreignQuote) return block;

        const what =
          block.type === "call_stack_diff" ? "Call stack" : "Database lens";

        const title = isStringValue(block.title) ? ` “${block.title}”` : "";

        // Its own repository's ranges too, so none of it is lost.
        return [
          {
            type: "markdown",
            id: allocate("block"),
            markdown: `${what}${title} (from ${repositoryName(foreignQuote[0].repositoryId)}), kept as snapshots below.`,
          },
          ...quotes(block, pinsIn).map(([pins, anchor], index) =>
            snapshot(index === 0 ? block.id : allocate("block"), pins, anchor),
          ),
        ];
      }

      return block;
    });

  /** The ranges a block's frames or operations quote at the pins `read`
   * accepts. */
  function quotes(
    block: JsonValue,
    read: typeof pinsIn,
    inherited?: JsonValue,
  ): [{ repositoryId: string; head: string; base?: string }, string][] {
    if (Array.isArray(block))
      return block.flatMap((item) => quotes(item, read, inherited));

    if (!isJsonObject(block)) return [];
    const scope = block.pins ?? inherited;
    const pins = read(scope);

    const own: [
      { repositoryId: string; head: string; base?: string },
      string,
    ][] = pins
      ? [
          block.source,
          block.callSite,
          ...(Array.isArray(block.contextSources) ? block.contextSources : []),
          ...(Array.isArray(block.sources) ? block.sources : []),
        ].flatMap((anchor): [typeof pins, string][] =>
          isStringValue(anchor) ? [[pins, anchor]] : [],
        )
      : [];

    return [
      ...own,
      ...Object.entries(block)
        .filter(([key]) => key !== "pins")
        .flatMap(([, value]) =>
          Array.isArray(value) || isJsonObject(value)
            ? quotes(value, read, scope)
            : [],
        ),
    ];
  }

  function unlinkSourceLinks(
    markdown: string,
    pins: { repositoryId: string; head: string; base?: string },
  ) {
    let result = markdown;

    // Rewrite from the end so earlier offsets stay valid.
    const links = [...markdownNodes(parseMarkdown(markdown))]
      .filter(
        (node) =>
          node.type === "link" &&
          SOURCE_LINK.test(node.url ?? "") &&
          node.position?.start.offset !== undefined &&
          node.position.end.offset !== undefined,
      )
      .reverse();

    // Its text, then where it pointed, so neither is lost.
    for (const node of links)
      result =
        result.slice(0, node.position!.start.offset) +
        `${markdownText(node)} (\`${caption(pins, node.url!.replace(SOURCE_LINK, ""))}\`)` +
        result.slice(node.position!.end.offset);

    return result;
  }

  return rest(peeks(document));
}
