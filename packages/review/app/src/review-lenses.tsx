import type { ReviewDiffLens } from "@dev.fast/review-protocol";
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

import {
  type LensSource,
  comparisonKey,
  selectionKey,
} from "../../src/lens-selection";
import type { ReviewApiClient } from "../../src/review-api/client";
import {
  type Lens,
  UNCATEGORIZED_LENS_ID,
} from "../../src/review-api/diff-lenses";
import type { ReviewProgress } from "../../src/review-api/review-progress";
import type { Snapshot } from "../../src/review-api/store";
import type { FileLineRange } from "../../src/source";
import {
  type CoverageProgress,
  coverageProgress,
  coverageSources,
  mergeCoverageProgress,
  scopedCoverage,
} from "../../src/viewed-coverage";
import { canvasQueryKeys } from "./canvas-query";
import { useReviewSession } from "./host/review-session";
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
  error: string | null;
  structuralDiffEnabled: boolean;
}

export type ReviewLensView = Pick<Lenses, "progress" | "resolve" | "error">;

const Context = createContext<Lenses | null>(null);

export const useReviewLenses = () => useContext(Context);

export function ReviewLensesProvider({
  client,
  snapshot,
  structuralDiffEnabled = true,
  coverageRevision = 0,
  children,
}: {
  client: ReviewApiClient;
  snapshot: Snapshot;
  structuralDiffEnabled?: boolean;
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
  const mode = structuralDiffEnabled ? "structural" : "textual";
  const route = `/${snapshot.reviewId}/progress`;
  const progressKey = canvasQueryKeys.lensProgress(snapshot.version, mode);
  const selectedLens = useReviewPanel((state) => state.lens);

  // A lens chosen on another version or diff mode no longer applies.
  const activeId =
    selectedLens?.version === snapshot.version && selectedLens.mode === mode
      ? selectedLens.id
      : undefined;

  // Coverage events drive freshness, and a version or mode left behind is not
  // kept: returning to it reads again, as a first visit does.
  const read = useQuery({
    queryKey: progressKey,
    queryFn: ({ signal }) =>
      client.read<ReviewProgress>(
        `${route}?version=${snapshot.version}&mode=${mode}&wait=false`,
        signal,
      ),
    staleTime: Infinity,
    gcTime: 0,
  });

  const progress = read.data ?? null;

  const markViewed = useMutation({
    mutationFn: (input: {
      version: number;
      mode: typeof mode;
      files: { path: string; fingerprint: string; sources: FileLineRange[] }[];
      viewed: boolean;
    }) => client.post<ReviewProgress>(route, input),
    // A read that started before the mark must not land after it; it is
    // repeated once the mark has landed.
    onMutate: async ({ version, mode }) => {
      const queryKey = canvasQueryKeys.lensProgress(version, mode);

      if (queryClient.isFetching({ queryKey })) refreshAfterMark.current = true;
      await queryClient.cancelQueries({ queryKey });
    },
    // Only the version marked is updated, and only while it is still held.
    onSuccess: (next, { version, mode }) =>
      queryClient.setQueryData<ReviewProgress>(
        canvasQueryKeys.lensProgress(version, mode),
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
  }, [client, route, snapshot.version, mode, resetMark]);

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
  const error =
    markViewed.error && markViewed.submittedAt > read.dataUpdatedAt
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
        mode,
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

        if (
          sources.every(
            (source) =>
              progress?.resolvedSelections[selectionKey(source)] !== undefined,
          )
        )
          return "ready";

        return progress?.complete === true ? "unavailable" : "pending";
      },
      active,
      changedPaths,
      unfoldRanges,
      busy,
      error,
      structuralDiffEnabled,
      select: (id) => {
        if (!lenses.some((item) => item.id === id && !item.unavailable)) return;
        captureUiEvent(session, "diff_opened", {
          kind: structuralDiffEnabled ? "structural" : "file",
          via: "lens",
        });
        panelStore
          .getState()
          .selectLens({ id, version: snapshot.version, mode });
      },
      clear: () => panelStore.getState().clearLens(),
      resolve: (sources) =>
        sources.flatMap((source) =>
          (progress?.resolvedSelections[selectionKey(source)] ?? []).map(
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
      error,
      structuralDiffEnabled,
      client,
      route,
      snapshot,
      session,
      panelStore,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
