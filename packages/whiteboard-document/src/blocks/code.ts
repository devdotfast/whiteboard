import { defineBlock, text } from "./definition.js";

/** Shared with sequence steps. */
export const codeFields = { language: text.default("text"), text };

export const code = {
  type: "code",
  reference: ["- code {text, language?, caption?}"],
  schema: defineBlock("code", { ...codeFields, caption: text.optional() }),
} as const;
