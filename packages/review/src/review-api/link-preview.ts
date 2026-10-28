import type { Block } from "@dev.fast/whiteboard-document";

/** What a board link's hover card shows of the board or block it links to. */
export interface BoardLinkPreview {
  /** A block link: the title of the section the block is in. */
  section?: string;
  /** Markdown paragraphs, opening the board or block. */
  prose?: string[];
  /** A block link to code: its language and first lines. */
  code?: { language: string; lines: string[] };
  /** A block link to a diagram or other figure: its kind and title. */
  figure?: { type: string; title: string };
}

/** About what the card shows before it fades; more is cut, not sent. */
const PROSE_CHARACTERS = 700;

const CODE_LINES = 6;

function childBlocks(block: Block): Block[] {
  return "children" in block ? block.children : [];
}

/** Paragraphs of markdown, without headings. */
function paragraphs(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !paragraph.startsWith("#"));
}

/** The prose from the first markdown block on, in reading order, until the
 * card has enough. Diagrams and code before it are skipped. */
function openingProse(blocks: Block[]): string[] {
  const prose: string[] = [];
  let length = 0;

  const walk = (list: Block[]): boolean => {
    for (const block of list) {
      if (block.type === "markdown")
        for (const paragraph of paragraphs(block.markdown)) {
          prose.push(paragraph);
          length += paragraph.length;

          if (length >= PROSE_CHARACTERS) return true;
        }
      else if (walk(childBlocks(block))) return true;
    }

    return false;
  };

  walk(blocks);

  return prose;
}

/** The block and the title of the section it is in. */
function find(
  blocks: Block[],
  id: string,
  section?: string,
): { block: Block; section?: string } | undefined {
  for (const block of blocks) {
    if (block.id === id) return { block, section };

    const found = find(
      childBlocks(block),
      id,
      block.type === "section" ? block.title : section,
    );

    if (found) return found;
  }

  return undefined;
}

/** The opening prose of a board, or one block of it. */
export function boardLinkPreview(
  document: Block[],
  blockId?: string,
): BoardLinkPreview {
  if (blockId === undefined) return { prose: openingProse(document) };

  const found = find(document, blockId);

  if (!found) return {};

  const { block } = found;
  // A section link is about the section itself.
  const section = block.type === "section" ? block.title : found.section;

  if (block.type === "code")
    return {
      ...(section && { section }),
      code: {
        language: block.language,
        lines: block.text.split("\n").slice(0, CODE_LINES),
      },
    };

  const prose = openingProse([block]);

  if (prose.length) return { ...(section && { section }), prose };

  const title = "title" in block ? block.title : undefined;

  return {
    ...(section && { section }),
    figure: { type: block.type, title: title ?? "" },
  };
}
