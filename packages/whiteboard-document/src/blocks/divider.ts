import { defineBlock } from "./definition.js";

export const divider = {
  type: "divider",
  reference: ["- divider {}"],
  schema: defineBlock("divider", {}),
} as const;
