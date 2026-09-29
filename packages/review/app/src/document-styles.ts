import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

// The review document: the article column and the prose it renders. Prose
// styles hold only inside a document, so a renderer used elsewhere keeps the
// browser's defaults; the `review-document`, `api-document-node` and
// `api-document-node--prose` classes stay on the DOM as the markers.

const inDocument = ":is(.review-document *)";

// A block's own element: it sits in the prose column.
const inBlock = ":is(.review-document .api-document-node > *)";

// Inside a Markdown or trace quote block.
const inProse = ":is(.review-document .api-document-node--prose *)";

// An element straight in the article.
const inArticle = ":is(.review-document > *)";

const inLink = ":is(.review-document a *)";

const inOpenLink = ":is(.review-document a[data-review-anchor-open] *)";

const afterItem = ":is(.review-document .api-document-node--prose li + *)";

// The scratchpad has no title, so its opening heading sits at the top.
const scratchpadOpening =
  ':is(.review-document[data-kind="scratchpad"] > .api-document-node:first-child *):first-child';

const narrow = "@media (max-width: 720px)";

const compact = "@container review-content (max-width: 1080px)";

const withHeader = ":has(.review-document-header)";

const withLens = ":has(.database-lens)";

const proseColumn = `min(100%, ${tokens.reviewProseMaxWidth})`;

const proseMaxWidth = `calc(100cqi - 2 * ${tokens.reviewDocumentPaddingInline})`;

export const documentStyles = stylex.create({
  article: {
    position: "relative",
    "--review-inline-diagram-max-width": "1120px",
    "--review-document-padding-inline": {
      default: "clamp(20px, calc((100cqi - 720px) * 0.122 + 20px), 64px)",
      [narrow]: "clamp(12px, 4vw, 20px)",
    },
    "--review-document-padding-block-start": "28px",
    "--review-document-padding-block-end": {
      default: "72px",
      [narrow]: "48px",
    },
    "--review-prose-max-width": { default: "720px", [withHeader]: "760px" },
    flex: { default: "1 1 860px", [compact]: "0 1 auto" },
    width: {
      default: "100%",
      [withLens]: "min(1360px, calc(100% - 32px))",
      [narrow]: "100%",
    },
    maxWidth: {
      default: "860px",
      [withHeader]: "900px",
      [narrow]: { default: "none", [withHeader]: "900px" },
    },
    minWidth: 0,
    margin: {
      default: "0 auto 96px",
      [compact]: { default: "0 auto", [narrow]: 0 },
      [narrow]: 0,
    },
    padding: {
      default: `${tokens.reviewDocumentPaddingBlockStart} ${tokens.reviewDocumentPaddingInline} ${tokens.reviewDocumentPaddingBlockEnd}`,
      [compact]: `28px ${tokens.reviewDocumentPaddingInline}`,
    },
    backgroundColor: tokens.transparent,
    color: tokens.ink,
    fontFamily: tokens.fontSerif,
    fontSize: "17px",
    lineHeight: 1.6,
  },
  // Beside an open side peek the column narrows its inline diagrams, and a
  // database lens keeps a smaller gutter.
  articlePeekOpen: {
    "--review-inline-diagram-max-width": "1000px",
    width: {
      default: "100%",
      [withLens]: "calc(100% - 24px)",
      [narrow]: "100%",
    },
    maxWidth: {
      default: "860px",
      [withHeader]: "900px",
      [narrow]: {
        default: "none",
        [withHeader]: { default: "900px", [withLens]: "none" },
      },
    },
  },
  h1: {
    width: { default: null, [inDocument]: proseColumn },
    margin: { default: null, [inDocument]: "28px auto 18px" },
    marginTop: { default: null, [scratchpadOpening]: 0 },
    color: { default: null, [inDocument]: tokens.ink },
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
    fontSize: { default: null, [inDocument]: "34px" },
    fontWeight: { default: null, [inDocument]: 500 },
    lineHeight: { default: null, [inDocument]: "40px" },
    letterSpacing: { default: null, [inDocument]: "-0.005em" },
    textAlign: { default: null, [inDocument]: "left" },
  },
  h2: {
    // A heading jumped to from the contents lands this far below the scroll
    // edge: clear of the edge for scroll-synced highlighting, and the same
    // slack the contents rail leaves under the last heading.
    scrollMarginTop: { default: null, [inDocument]: "24px" },
    width: { default: null, [inBlock]: proseColumn },
    maxWidth: { default: null, [inBlock]: proseMaxWidth },
    margin: { default: null, [inDocument]: "40px auto 12px" },
    marginTop: { default: null, [scratchpadOpening]: 0 },
    color: { default: null, [inDocument]: tokens.ink },
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
    fontSize: { default: null, [inDocument]: "26px" },
    fontWeight: { default: null, [inDocument]: 500 },
    lineHeight: { default: null, [inDocument]: "32px" },
  },
  h3: {
    scrollMarginTop: { default: null, [inDocument]: "24px" },
    width: { default: null, [inBlock]: proseColumn },
    maxWidth: { default: null, [inBlock]: proseMaxWidth },
    margin: { default: null, [inDocument]: "30px auto 10px" },
    marginTop: { default: null, [scratchpadOpening]: 0 },
    color: { default: null, [inDocument]: tokens.ink },
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
    fontSize: { default: null, [inDocument]: "20px" },
    fontWeight: { default: null, [inDocument]: 500 },
    lineHeight: { default: null, [inDocument]: "23px" },
  },
  // A block in the prose column: lists, quotes, images, tutorial controls.
  column: {
    width: { default: null, [inBlock]: proseColumn },
    maxWidth: { default: null, [inBlock]: proseMaxWidth },
    marginInline: { default: null, [inBlock]: "auto" },
  },
  serif: {
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
  },
  paragraph: {
    width: { default: null, [inBlock]: proseColumn },
    maxWidth: { default: null, [inBlock]: proseMaxWidth },
    margin: { default: null, [inProse]: "14px 0" },
    marginInline: { default: null, [inBlock]: "auto" },
    color: { default: null, [inProse]: tokens.ink },
    fontFamily: { default: null, [inProse]: tokens.fontSerif },
    fontSize: { default: null, [inProse]: "15px" },
    lineHeight: { default: null, [inProse]: 1.72 },
    textAlign: { default: null, [inProse]: "left" },
  },
  // A list item's paragraphs sit flush with the item.
  itemParagraph: {
    marginTop: {
      default: null,
      ":first-child": { default: null, [inProse]: 0 },
    },
    marginBottom: {
      default: null,
      ":last-child": { default: null, [inProse]: 0 },
    },
  },
  item: {
    marginTop: { default: null, [afterItem]: "8px" },
    color: { default: null, [inProse]: tokens.ink },
    fontFamily: { default: null, [inProse]: tokens.fontSerif },
    fontSize: { default: null, [inProse]: "15px" },
    lineHeight: { default: null, [inProse]: 1.72 },
    textAlign: { default: null, [inProse]: "left" },
  },
  // Document copy outside a Markdown block, read as its paragraphs: the
  // retained-source note, a stale block's notice, the fallback message.
  note: {
    margin: { default: null, [inDocument]: "14px 0" },
    color: { default: null, [inDocument]: tokens.ink },
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
    fontSize: { default: null, [inDocument]: "15px" },
    lineHeight: { default: null, [inDocument]: 1.72 },
    textAlign: { default: null, [inDocument]: "left" },
  },
  // The retained-source note sits in the prose column, flush left.
  articleNote: {
    width: { default: null, [inArticle]: proseColumn },
    maxWidth: { default: null, [inArticle]: proseMaxWidth },
  },
  // Links are just text in the link color, prose and code chips alike, with
  // no visited distinction. Hover restores the plain underline, and the link
  // whose peek is open carries a quiet wash of the same color.
  link: {
    color: { default: null, [inDocument]: tokens.accent },
    textDecoration: {
      default: null,
      [inDocument]: { default: "none", ":hover": "underline" },
    },
    backgroundColor: {
      default: null,
      [inDocument]: {
        default: null,
        ":is([data-review-anchor-open])": tokens.linkOpenWash,
      },
    },
  },
  code: {
    padding: { default: null, [inDocument]: "2px 5px" },
    borderRadius: { default: null, [inDocument]: "3px" },
    backgroundColor: {
      default: null,
      [inDocument]: tokens.well,
      [inOpenLink]: tokens.linkOpenWash,
    },
    color: {
      default: null,
      [inDocument]: tokens.ink,
      [inLink]: tokens.accent,
    },
    fontFamily: { default: null, [inDocument]: tokens.fontMono },
    fontSize: { default: null, [inDocument]: "0.85em" },
  },
  table: {
    width: { default: null, [inDocument]: "min(100%, 600px)" },
    margin: { default: null, [inDocument]: "24px auto" },
    borderCollapse: { default: null, [inDocument]: "collapse" },
    color: { default: null, [inDocument]: tokens.ink },
    fontFamily: { default: null, [inDocument]: tokens.fontMono },
    fontSize: { default: null, [inDocument]: "13px" },
    lineHeight: { default: null, [inDocument]: 1.55 },
    tableLayout: { default: null, [inDocument]: "fixed" },
  },
  cell: {
    padding: { default: null, [inDocument]: "8px 10px" },
    borderWidth: { default: null, [inDocument]: "1px" },
    borderStyle: { default: null, [inDocument]: "solid" },
    borderColor: { default: null, [inDocument]: tokens.rule },
    overflowWrap: { default: null, [inDocument]: "anywhere" },
    textAlign: { default: null, [inDocument]: "left" },
    verticalAlign: { default: null, [inDocument]: "top" },
  },
  headerCell: {
    backgroundColor: { default: null, [inDocument]: tokens.tray },
    color: { default: null, [inDocument]: tokens.ink },
    fontWeight: { default: null, [inDocument]: 600 },
  },
  // Phrasing content, so an <img> laid out like an image block.
  image: {
    display: "block",
    maxWidth: "100%",
    height: "auto",
  },
});
