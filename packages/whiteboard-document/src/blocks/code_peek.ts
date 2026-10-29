import { anchorSchema } from "../lens-selection.js";
import { defineBlock, elementPins, text } from "./definition.js";

export const code_peek = {
  type: "code_peek",
  reference: ["- code_peek {source: anchor, caption?, pins?}"],
  schema: defineBlock("code_peek", {
    source: anchorSchema,
    pins: elementPins,
    // Not rendered yet.
    caption: text.optional(),
  }),
} as const;
