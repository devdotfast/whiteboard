import {
  type AskHistoryEntry,
  askHistoryEntrySchema,
} from "@review/ask/thread-state";
import {
  type ReactElement,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { useReviewSession } from "./host/review-session";

export interface AskHistory {
  /** Newest first; null until the first read. */
  entries: AskHistoryEntry[] | null;
  error: string | null;
  /** Reads the list again, after a conversation is saved or continued. */
  refresh: () => void;
  /** Whether it was deleted; a failure lands in `error`. */
  forget: (id: string) => Promise<boolean>;
}

const AskHistoryContext = createContext<AskHistory | null>(null);

const listSchema = z.object({ threads: z.array(askHistoryEntrySchema) });

/** This review's saved conversations, shared by the document's marks, the
 * history list, and the Ask panel that adds to them. */
export function AskHistoryProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const session = useReviewSession();
  const [entries, setEntries] = useState<AskHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A slower, older read must not replace a newer one.
  const reads = useRef(0);

  const refresh = useCallback(() => {
    const read = ++reads.current;

    void session
      .fetch("/ask/threads")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unavailable");

        const { threads } = listSchema.parse(await response.json());

        if (read !== reads.current) return;
        setEntries(threads);
        setError(null);
      })
      .catch(() => {
        if (read === reads.current)
          setError("Whiteboard could not read saved conversations.");
      });
  }, [session]);

  useEffect(refresh, [refresh]);

  const forget = useCallback(
    async (id: string) => {
      const response = await session
        .fetch(`/ask/${id}`, { method: "DELETE" })
        .catch(() => null);

      if (!response?.ok) {
        setError("Whiteboard could not delete that conversation.");

        return false;
      }

      reads.current += 1;
      setEntries((list) => list?.filter((entry) => entry.id !== id) ?? null);

      return true;
    },
    [session],
  );

  const value = useMemo(
    () => ({ entries, error, refresh, forget }),
    [entries, error, refresh, forget],
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
