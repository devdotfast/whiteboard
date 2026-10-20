import {
  type AskHistoryEntry,
  askHistoryEntrySchema,
} from "@review/ask/thread-state";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ReactElement,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { z } from "zod";

import { canvasQueryKeys } from "./canvas-query";
import { useReviewSession } from "./host/review-session";

export interface AskHistory {
  /** The project's conversations, newest first; null until the first read. */
  entries: AskHistoryEntry[] | null;
  /** The board on screen. Only threads anchored on it get marks. */
  board: string | null;
  error: string | null;
  /** Reads the list again, after a conversation is saved or continued. */
  refresh: () => void;
  /** Whether it was deleted; a failure lands in `error`. */
  forget: (id: string) => Promise<boolean>;
  previewId: string | null;
  preview: (id: string | null) => void;
  revealRequest: AskHistoryEntry | null;
  reveal: (entry: AskHistoryEntry) => void;
  /** Conversations whose passage changed in the version on screen: its
   * block is gone, or an edit touched its words. */
  outdated: ReadonlySet<string>;
  /** The document's marks say which are outdated as they place them. */
  reportOutdated: (ids: ReadonlySet<string>) => void;
}

const AskHistoryContext = createContext<AskHistory | null>(null);

const listSchema = z.object({
  threads: z.array(askHistoryEntrySchema),
  board: z.string().optional(),
});

/** This review's saved conversations, shared by the document's marks, the
 * history list, and the Ask panel that adds to them. */
export function AskHistoryProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const session = useReviewSession();
  const [previewId, preview] = useState<string | null>(null);

  const [revealRequest, setRevealRequest] = useState<AskHistoryEntry | null>(
    null,
  );

  const reveal = useCallback(
    (entry: AskHistoryEntry) => setRevealRequest({ ...entry }),
    [],
  );

  const [outdated, setOutdated] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Placing marks reports on every layout; only a different set is news.
  const reportOutdated = useCallback((ids: ReadonlySet<string>) => {
    setOutdated((current) =>
      current.size === ids.size && [...ids].every((id) => current.has(id))
        ? current
        : ids,
    );
  }, []);

  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: canvasQueryKeys.askThreads(),
    queryFn: async () => {
      const response = await session.fetch("/ask/threads");

      if (!response.ok) throw new Error("Unavailable");

      return listSchema.parse(await response.json());
    },
  });

  const refresh = useCallback(
    () =>
      void queryClient.invalidateQueries({
        queryKey: canvasQueryKeys.askThreads(),
      }),
    [queryClient],
  );

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const response = await session.fetch(`/ask/${id}`, { method: "DELETE" });

      if (!response.ok) throw new Error("Unavailable");
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: canvasQueryKeys.askThreads(),
      }),
  });

  const { mutateAsync: removeThread } = remove;

  const forget = useCallback(
    async (id: string) => {
      try {
        await removeThread(id);

        return true;
      } catch {
        return false;
      }
    },
    [removeThread],
  );

  const entries = list.data?.threads ?? null;
  const board = list.data?.board ?? null;

  const error = remove.error
    ? "Whiteboard could not delete that conversation."
    : list.error
      ? "Whiteboard could not read saved conversations."
      : null;

  const value = useMemo(
    () => ({
      entries,
      board,
      error,
      refresh,
      forget,
      outdated,
      reportOutdated,
      previewId,
      preview,
      revealRequest,
      reveal,
    }),
    [
      entries,
      board,
      error,
      refresh,
      forget,
      outdated,
      reportOutdated,
      previewId,
      revealRequest,
      reveal,
    ],
  );

  return (
    <AskHistoryContext.Provider value={value}>
      {children}
    </AskHistoryContext.Provider>
  );
}

export function useAskHistory(): AskHistory | null {
  return useContext(AskHistoryContext);
}
