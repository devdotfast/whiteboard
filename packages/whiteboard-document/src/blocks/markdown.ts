import { sourcePinsSchema } from "../source.js";
import { defineBlock, text } from "./definition.js";

export const markdown = {
  type: "markdown",
  schema: defineBlock("markdown", {
    markdown: text.describe(
      "Safe Markdown. Repository file links must use [label](whiteboard:source/head/path#L10-L24) or whiteboard:source/base/path#L10-L24, or whiteboard:source/<commit>/path#L10-L24 at any commit of the board's repository, with a repository-relative path and verified line numbers. Link another board as [label](whiteboard:board/<sessionId>) or one of its blocks as whiteboard:board/<sessionId>#<blockId>; both must exist. Relative paths, absolute filesystem paths, and file/editor URLs are rejected. External links use https://, http://, or mailto:; document anchors use #heading.",
    ),
    pins: sourcePinsSchema
      .optional()
      .describe(
        "Repository and commits this block's whiteboard:source/ links resolve against, instead of the document's pins.",
      ),
  }),
} as const;
