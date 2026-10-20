import type { ApiDocumentData } from "@canvas/api-document";
import { REVIEW_BOARDS_FLUSH_EVENT } from "@dev.fast/review-protocol";
import type { ReviewApiClient } from "@review/review-api/client";
import { ReviewApiError } from "@review/review-api/client";

import { type Board, storedBlocks } from "./board-doc";
import {
  type BoardTransport,
  type KeptTyping,
  SaveConflict,
  type SaveResponse,
} from "./sync";

// The board-sync seam's production adapter: the Whiteboard server, the
// window and this browser's storage.

/** How long the server holds the block a person is in without a word. */
const FOCUS_HEARTBEAT_MS = 5_000;

const keptKey = (reviewId: string) => `whiteboard:unsaved:${reviewId}`;

export function httpBoardTransport(
  client: ReviewApiClient,
  reviewId: string,
): BoardTransport {
  // The hold: sent from the moment the board opens, so the server keeps it
  // open, and repeated while the person stays, so a crashed app lets go.
  const clientId = crypto.randomUUID();
  let held: string | null = null;

  const send = (open?: false) =>
    client
      .post(`/${reviewId}/focus`, {
        clientId,
        blockId: held,
        ...(open === false && { open }),
      })
      .catch(() => {});

  void send();

  const heartbeat = setInterval(() => void send(), FOCUS_HEARTBEAT_MS);

  return {
    async save(request) {
      try {
        return await client.post<SaveResponse>(
          `/${reviewId}/person-edit`,
          request,
        );
      } catch (error) {
        if (error instanceof ReviewApiError && error.status === 409)
          throw new SaveConflict(error.message);

        throw error;
      }
    },
    async read() {
      const board = await client.read<ApiDocumentData["snapshot"]>(
        `/${reviewId}`,
      );

      return {
        version: board.version,
        title: board.title,
        document: storedBlocks(board.document),
        personEdit: board.personEdit,
      };
    },
    hold(blockId, open = true) {
      if (!open) {
        clearInterval(heartbeat);
        held = null;
        void send(false);

        return;
      }

      if (blockId === held) return;
      held = blockId;
      void send();
    },
    shutdowns(flush) {
      const asked = (event: Event) => {
        const saved = flush();

        if (event instanceof CustomEvent) event.detail?.waitFor?.(saved);
      };

      window.addEventListener(REVIEW_BOARDS_FLUSH_EVENT, asked);
      window.addEventListener("pagehide", asked);

      return () => {
        window.removeEventListener(REVIEW_BOARDS_FLUSH_EVENT, asked);
        window.removeEventListener("pagehide", asked);
      };
    },
    keep(kept) {
      try {
        localStorage.setItem(keptKey(reviewId), JSON.stringify(kept));
      } catch {
        console.error(
          `[board editor] Could not keep the unsaved typing of whiteboard ${reviewId}.`,
        );
      }
    },
    take() {
      try {
        const kept = localStorage.getItem(keptKey(reviewId));

        if (kept === null) return undefined;
        localStorage.removeItem(keptKey(reviewId));

        // SAFETY: only `keep` writes this key, with KeptTyping. One kept
        // before typing carried its base is dropped: merging it needs that.
        const typing = JSON.parse(kept) as Partial<KeptTyping>;

        if (!typing.base) return undefined;

        // SAFETY: written whole by `keep`, base included, as checked above.
        return typing as KeptTyping;
      } catch {
        return undefined;
      }
    },
  };
}
