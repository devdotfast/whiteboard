import { defineBlock, label } from "./definition.js";

export const software_map = {
  type: "software_map",
  reference: ["- software_map {mapVersionId, focusElementId?}"],
  schema: defineBlock("software_map", {
    mapVersionId: label,
    focusElementId: label.optional(),
  }),
} as const;
