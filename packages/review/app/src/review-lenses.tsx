import type { ReviewDiffLens } from "@dev.fast/review-protocol";
import {
  type LensSource,
  comparisonKey,
  selectionKey,
} from "@review/lens-selection";
import type { ReviewApiClient } from "@review/review-api/client";
import {
  type Lens,
  UNCATEGORIZED_LENS_ID,
} from "@review/review-api/diff-lenses";
import type { ReviewProgress } from "@review/review-api/review-progress";
import type { Snapshot } from "@review/review-api/store";
import type { FileLineRange } from "@review/source";
import {
  type CoverageProgress,
  coverageProgress,
  coverageSources,
  mergeCoverageProgress,
  scopedCoverage,
} from "@review/viewed-coverage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { canvasQueryKeys } from "./canvas-query";
import { useReviewSession } from "./host/review-session";
import { checkoutUnavailable } from "./missing-checkout-banner";
import { useReviewPanel, useReviewPanelStore } from "./review-panel";
import { captureUiEvent } from "./ui-telemetry";

/** A resolved selection, tagged with the comparison its own pins name so its
 * changed lines are counted there and not in the document's comparison. */
export interface ResolvedRange extends FileLineRange {
  comparison?: string;
}

interface Lenses {
  progress: ReviewProgress | null;
  lenses: ReviewProgress["lenses"];
  /** The lenses as authored on the version shown, targets and all. */
  authored: readonly Lens[];
  availability(
    sources: readonly LensSource[],
  ): "pending" | "ready" | "unavailable";
  active: ReviewDiffLens | undefined;
  select(id: string, sources?: ReviewDiffLens["ranges"]): void;
  clear(): void;
  resolve(sources: readonly LensSource[]): ResolvedRange[];
  stats(sources?: readonly ResolvedRange[]): CoverageProgress;
  mark(
    sources: readonly FileLineRange[] | undefined,
    viewed: boolean,
    collapseLens?: boolean,
  ): Promise<void>;
  changedPaths: string[];
  unfoldRanges: readonly FileLineRange[];
  busy: boolean;
  readOnly: boolean;
  error: string | null;
}

export type ReviewLensView = Pick<Lenses, "progress" | "resolve" | "error">;

const Context = createContext<Lenses | null>(null);

export const useReviewLenses = () => useContext(Context);

export function ReviewLensesProvider({
  client,
  snapshot,
  coverageRevision = 0,
  children,
}: {
  client: ReviewApiClient;
  snapshot: Snapshot;
  coverageRevision?: number;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const session = useReviewSession();
  const panelStore = useReviewPanelStore();
  const [changedPaths, setChangedPaths] = useState<string[]>([]);

  const [unfoldRanges, setUnfoldRanges] = useState<readonly FileLineRange[]>(
    [],
  );

  const generation = useRef(0);
  const pending = useRef(false);
  const refreshAfterMark = useRef(false);
  const route = `/${snapshot.reviewId}/progress`;
  const progressKey = canvasQueryKeys.lensProgress(snapshot.version);
  const selectedLens = useReviewPanel((state) => state.lens);

  // A lens chosen on another version no longer applies.
  const activeId =
    selectedLens?.version === snapshot.version ? selectedLens.id : undefined;

  // Coverage events drive freshness, and a version left behind is not kept:
  // returning to it reads again, as a first visit does.
  const read = useQuery({
    queryKey: progressKey,
    queryFn: ({ signal }) =>
      client.read<ReviewProgress>(
        `${route}?version=${snapshot.version}&wait=false`,
        signal,
      ),
    enabled: !snapshot.sourceUnavailable,
    staleTime: Infinity,
    gcTime: 0,
  });

  const progress = read.data ?? null;

  // Where each selection resolved, by the commits it was read at: a new
  // version's progress is read afresh, and a peek it leaves as it was keeps
  // showing its code meanwhile rather than "Loading code…".
  const resolvedBefore = useRef(new Map<string, ResolvedRange[]>());
  const pinsKey = JSON.stringify(snapshot.pins ?? null);

  const resolvedSelection = (source: LensSource) => {
    const key = `${pinsKey}|${selectionKey(source)}`;
    const ranges = progress?.resolvedSelections[selectionKey(source)];

    if (ranges) resolvedBefore.current.set(key, ranges);

    return ranges ?? resolvedBefore.current.get(key);
  };

  const markViewed = useMutation({
    mutationFn: (input: {
      version: number;
      files: { path: string; fingerprint: string; sources: FileLineRange[] }[];
      viewed: boolean;
    }) => client.post<ReviewProgress>(route, input),
    // A read that started before the mark must not land after it; it is
    // repeated once the mark has landed.
    onMutate: async ({ version }) => {
      const queryKey = canvasQueryKeys.lensProgress(version);

      if (queryClient.isFetching({ queryKey })) refreshAfterMark.current = true;
      await queryClient.cancelQueries({ queryKey });
    },
    // Only the version marked is updated, and only while it is still held.
    onSuccess: (next, { version }) =>
      queryClient.setQueryData<ReviewProgress>(
        canvasQueryKeys.lensProgress(version),
        (current) =>
          current && { ...next, lenses: current.lenses ?? next.lenses },
      ),
  });

  const refreshProgress = () =>
    void queryClient.invalidateQueries({
      queryKey: canvasQueryKeys.allLensProgress(),
    });

  const resetMark = markViewed.reset;
  useEffect(() => {
    generation.current++;
    pending.current = false;
    refreshAfterMark.current = false;
    resetMark();
    setChangedPaths([]);
    setUnfoldRanges([]);

    return () => {
      generation.current++;
    };
  }, [client, route, snapshot.version, resetMark]);

  // Live coverage and worktree saves mark every held progress stale; a mark
  // in flight defers the reread until it lands.
  const freshness = `${coverageRevision}:${snapshot.pins?.worktreeRevision ?? ""}`;
  const revision = useRef(freshness);
  useEffect(() => {
    if (revision.current === freshness) return;
    revision.current = freshness;

    if (pending.current) refreshAfterMark.current = true;
    else refreshProgress();
  }, [freshness]);

  const busy = markViewed.isPending;

  // The latest outcome wins: a later read clears a failed mark.
  const error = snapshot.sourceUnavailable
    ? checkoutUnavailable(session.review?.host)
    : markViewed.error && markViewed.submittedAt > read.dataUpdatedAt
      ? String(markViewed.error)
      : read.error
        ? String(read.error)
        : null;

  const lenses: ReviewProgress["lenses"] = progress?.lenses ?? [
    ...(snapshot.lenses ?? []).map((lens) => ({
      id: lens.id,
      title: lens.title,
      sources: [],
      pending: true,
    })),
    {
      id: UNCATEGORIZED_LENS_ID,
      title: "Uncategorized changes",
      sources: [],
      pending: true,
    },
  ];

  const item = lenses.find((item) => item.id === activeId);
  // Scope contains only resolved correspondence; navigation anchors are not coverage.
  const ranges = item?.sources ?? [];
  const scopeKey = JSON.stringify(ranges);

  const active = useMemo(
    () =>
      item
        ? {
            id: item.id,
            title: item.title,
            reviewId: snapshot.reviewId,
            version: snapshot.version,
            // SAFETY: scopeKey was produced from item.sources, which are validated file ranges.
            ranges: JSON.parse(scopeKey) as FileLineRange[],
            wholeFiles: item.wholeFiles ?? false,
          }
        : undefined,
    [
      activeId,
      item?.id,
      item?.title,
      item?.wholeFiles,
      snapshot.reviewId,
      snapshot.version,
      scopeKey,
    ],
  );

  const mark: Lenses["mark"] = async (
    sources,
    viewed,
    collapseLens = false,
  ) => {
    if (!progress || pending.current) return;
    pending.current = true;
    const currentGeneration = generation.current;

    const files = progress.files
      .map((file) => ({ ...file, scope: scopedCoverage(file, sources) }))
      .filter((file) => file.scope.base.length || file.scope.head.length)
      .map((file) => ({
        path: file.path,
        fingerprint: file.fingerprint,
        sources: coverageSources(file, file.scope),
      }));

    try {
      await markViewed.mutateAsync({
        version: snapshot.version,
        files,
        viewed,
      });

      if (generation.current !== currentGeneration) return;
      setChangedPaths(files.map((file) => file.path));
      setUnfoldRanges(viewed ? [] : files.flatMap((file) => file.sources));

      if (collapseLens && viewed) panelStore.getState().clearLens();
    } catch {
      // The mutation holds the error while this version is shown.
    } finally {
      if (generation.current === currentGeneration) {
        pending.current = false;

        if (refreshAfterMark.current) {
          refreshAfterMark.current = false;
          refreshProgress();
        }
      }
    }
  };

  const value = useMemo<Lenses>(
    () => ({
      progress,
      lenses,
      authored: snapshot.lenses ?? [],
      availability: (sources) => {
        if (
          sources.some(
            (source) => progress?.unavailableSelections?.[selectionKey(source)],
          )
        )
          return "unavailable";

        if (sources.every((source) => resolvedSelection(source) !== undefined))
          return "ready";

        return progress?.complete === true ? "unavailable" : "pending";
      },
      active,
      changedPaths,
      unfoldRanges,
      busy,
      readOnly: Boolean(snapshot.trashedAt),
      error,
      select: (id) => {
        if (!lenses.some((item) => item.id === id && !item.unavailable)) return;
        captureUiEvent(session, "diff_opened", {
          kind: "structural",
          via: "lens",
        });
        panelStore.getState().selectLens({ id, version: snapshot.version });
      },
      clear: () => panelStore.getState().clearLens(),
      resolve: (sources) =>
        sources.flatMap((source) =>
          (resolvedSelection(source) ?? []).map(
            (range): ResolvedRange =>
              source.pins
                ? { ...range, comparison: comparisonKey(source.pins) }
                : range,
          ),
        ),
      // Each selection counts against the comparison its own pins name: the
      // document's files, or the files of a reference's own comparison.
      stats: (sources) => {
        if (!sources) return coverageProgress(progress?.files ?? []);

        const groups = new Map<string | undefined, ResolvedRange[]>();

        for (const source of sources) {
          const key =
            source.comparison !== undefined &&
            progress?.referenceFiles?.[source.comparison]
              ? source.comparison
              : undefined;

          groups.set(key, [...(groups.get(key) ?? []), source]);
        }

        return mergeCoverageProgress(
          [...groups].map(([key, ranges]) =>
            coverageProgress(
              key === undefined
                ? (progress?.files ?? [])
                : Object.values(progress!.referenceFiles![key]!),
              ranges,
            ),
          ),
        );
      },
      mark,
    }),
    [
      progress,
      lenses,
      active,
      changedPaths,
      unfoldRanges,
      busy,
      snapshot.trashedAt,
      error,
      client,
      route,
      snapshot,
      session,
      panelStore,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
