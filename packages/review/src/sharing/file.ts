import { createHash } from "node:crypto";

import {
  SHARE_FORMAT,
  type ShareBundle,
  shareBundleSchema,
} from "@dev.fast/review-share-protocol";
import { ReviewInputError } from "@dev.fast/whiteboard-document";
import { slugify } from "@review/slug.js";
import { z } from "zod";

export const WHITEBOARD_FILE_EXTENSION = ".whiteboard";

const headerSchema = z.looseObject({ format: z.string() });

export function whiteboardFileName(title: string): string {
  return `${slugify(title) || "untitled"}${WHITEBOARD_FILE_EXTENSION}`;
}

export function whiteboardFileText(bundle: ShareBundle): string {
  return JSON.stringify(bundle, null, 2) + "\n";
}

export function parseWhiteboardFile(text: string): ShareBundle {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  const header = headerSchema.safeParse(parsed);

  if (!header.success)
    throw new ReviewInputError("This is not a Whiteboard file.", 400);

  if (header.data.format !== SHARE_FORMAT)
    throw new ReviewInputError(
      "This file needs a different Whiteboard version.",
      400,
    );

  return shareBundleSchema.parse(parsed);
}

export function whiteboardFileKey(text: string): string {
  return createHash("sha256")
    .update("whiteboard-file\0")
    .update(text)
    .digest("hex");
}
