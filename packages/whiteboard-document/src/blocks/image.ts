import { defineBlock, label, text } from "./definition.js";

export const image = {
  type: "image",
  reference: ["- image {assetId from session_upload, alt, caption?}"],
  schema: defineBlock("image", {
    assetId: label,
    alt: label,
    caption: text.optional(),
  }),
} as const;
