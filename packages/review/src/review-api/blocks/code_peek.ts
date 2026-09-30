import { diffSelectionSchema } from "@review/lens-selection.js";

import { blockPins, defineBlock, text } from "./definition.js";

export const code_peek = {
  type: "code_peek",
  schema: defineBlock("code_peek", {
    source: diffSelectionSchema,
    pins: blockPins,
    // Not rendered yet.
    caption: text.optional(),
  }),
} as const;
