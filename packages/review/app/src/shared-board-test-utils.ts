import type { JsonValue } from "@dev.fast/review-protocol";
import type { ShareManifest } from "@dev.fast/review-share-protocol";
import { assignFreshIds, documentSchema } from "@review/review-api/document";
import type { parseSharedSnapshot } from "@review/sharing/content";

import type { SharedBoardBundle } from "./web-entry-api";

const goldens = import.meta.glob<{ default: JsonValue }>(
  "./fixtures/saved-reviews/*.json",
  { eager: true },
);

/** A sealed share object: its JSON bytes, named by their digest. */
export async function object(
  value: JsonValue | ReturnType<typeof parseSharedSnapshot>,
) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

  const id = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return { id, bytes };
}

/** A share of a saved review, as the sender's Desktop seals it. */
export async function share(name: string): Promise<SharedBoardBundle> {
  // Authoring assigns ids before a board is shared.
  const document = documentSchema.parse(
    Object.entries(goldens).find(([key]) => key.endsWith(`/${name}.json`))![1]
      .default,
  );

  let nextId = 0;

  for (const block of document)
    assignFreshIds(block, (prefix) => `${prefix}-${++nextId}`);

  const snapshot = await object({
    reviewId: `shared-${name}`,
    version: 3,
    title: name,
    document,
    createdAt: "2026-10-20T00:00:00.000Z",
  });

  const presentation = await object({ maps: {} });

  const manifest: ShareManifest = {
    format: "review-share/1",
    reviewId: `shared-${name}`,
    version: 3,
    title: name,
    snapshot: snapshot.id,
    presentation: presentation.id,
    objects: [snapshot, presentation].map(({ id, bytes }) => ({
      id,
      sha256: id,
      size: bytes.byteLength,
    })),
    resources: [],
  };

  return {
    manifest,
    objects: new Map(
      [snapshot, presentation].map((item) => [item.id, item.bytes]),
    ),
  };
}
