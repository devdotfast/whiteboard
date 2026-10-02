import type {
  ReviewCanvasBridge,
  ReviewDiffFileWire,
} from "@dev.fast/review-protocol";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, createContext, useContext, useMemo } from "react";

import { canvasQueryKeys } from "./canvas-query";
import { useReviewSession } from "./host/review-session";
import { useReviewContainer } from "./review-root-context";

export type ReviewDiffFilesState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "unavailable" }
  | { status: "loaded"; files: ReviewDiffFileWire[] };

const ReviewDiffFilesContext = createContext<
  ReviewDiffFilesState & { revision?: string }
>({
  status: "loading",
});

// The canvas replaces its diff source when the pinned revision or diff mode
// changes, so the source's identity names the files it answers with.
const sourceIds = new WeakMap<ReviewCanvasBridge["diffView"], number>();

let nextSourceId = 0;

function sourceId(source: ReviewCanvasBridge["diffView"]): number {
  let id = sourceIds.get(source);

  if (id === undefined) sourceIds.set(source, (id = nextSourceId++));

  return id;
}

export function ReviewDiffFilesProvider({
  documentKey,
  revision,
  unavailable,
  children,
}: {
  documentKey: string;
  /** A live checkout's save generation: refetch, keeping the shown files. */
  revision?: string;
  /** The checkout is gone; nothing is fetched. */
  unavailable?: boolean;
  children: ReactNode;
}) {
  const session = useReviewSession();
  const diffView = session.bridge.diffView;
  const container = useReviewContainer();

  // The bridge read cannot be cancelled; a superseded result stays in its own key.
  const query = useQuery({
    queryKey: canvasQueryKeys.diffFiles(
      documentKey,
      sourceId(diffView),
      revision,
    ),
    queryFn: async () => {
      recordDiffSummaryRequest(container);
      const files = [...(await diffView.files())];
      recordDiffSummaryReady(container);

      return files;
    },
    enabled: !unavailable,
    // A source never changes its answer; a replaced one is never asked again.
    staleTime: Infinity,
    gcTime: 0,
    // A save refetches the same document and source; show its files meanwhile.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === documentKey &&
      previousQuery.queryKey[2] === sourceId(diffView)
        ? previous
        : undefined,
  });

  const value = useMemo<ReviewDiffFilesState & { revision?: string }>(
    () => ({
      ...(unavailable
        ? { status: "unavailable" }
        : query.status === "success"
          ? { status: "loaded", files: query.data }
          : query.status === "error"
            ? { status: "error", error: query.error.message }
            : { status: "loading" }),
      revision,
    }),
    [unavailable, query.status, query.data, query.error, revision],
  );

  return (
    <ReviewDiffFilesContext.Provider value={value}>
      {children}
    </ReviewDiffFilesContext.Provider>
  );
}

export function useReviewDiffFiles(): ReviewDiffFilesState & {
  revision?: string;
} {
  return useContext(ReviewDiffFilesContext);
}

function recordDiffSummaryRequest(container: HTMLElement | null): void {
  if (!container) return;
  const current = Number(container.dataset.reviewDiffSummaryRequestCount ?? 0);
  container.dataset.reviewDiffSummaryRequestCount = String(current + 1);
  container.dataset.reviewDiffSummaryStartedAfterMount = String(
    Boolean(container.querySelector(".review-app")),
  );
  container.dataset.reviewDiffSummaryIncludePatch = "false";
}

function recordDiffSummaryReady(container: HTMLElement | null): void {
  if (!container) return;
  const current = Number(container.dataset.reviewDiffSummaryReadyCount ?? 0);
  container.dataset.reviewDiffSummaryReadyCount = String(current + 1);
}
