import { anchorSchema } from "@review/lens-selection.js";

import { defineBlock, elementPins, text } from "./definition.js";

export const code_peek = {
  type: "code_peek",
  schema: defineBlock("code_peek", {
    source: anchorSchema,
    pins: elementPins,
    // Not rendered yet.
    caption: text.optional(),
  }),
} as const;
