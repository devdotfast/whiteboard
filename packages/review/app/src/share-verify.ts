import {
  MAX_SHARE_MANIFEST_BYTES,
  shareManifestSchema,
} from "@dev.fast/review-share-protocol";

import type { VerifySharedBoard } from "./web-entry-api";

/** The checks Desktop's import makes before it opens a share. */
export const verifySharedBoard: VerifySharedBoard = async ({
  manifest,
  objects,
}) => {
  const parsed = shareManifestSchema.parse(manifest);

  if (
    new TextEncoder().encode(JSON.stringify(parsed)).byteLength >
    MAX_SHARE_MANIFEST_BYTES
  )
    throw new Error("Share manifest is too large.");

  for (const object of parsed.objects) {
    const bytes = objects.get(object.id);

    if (
      !bytes ||
      bytes.byteLength !== object.size ||
      (await sha256(bytes)) !== object.sha256
    )
      throw new Error(`Shared object ${object.id} is missing or corrupt.`);
  }

  return { manifest: parsed, objects };
};

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
