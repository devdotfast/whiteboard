import {
  type ReviewApiSummary,
  type ReviewCanvasBridge,
  type ReviewCanvasSettings,
  boardTitle,
  parseReviewBoardPlace,
  parseReviewStackResponse,
} from "@dev.fast/review-protocol";
import type { ReviewApiClient } from "@review/review-api/client";
import { elements } from "@review/review-api/document";
import type { ReviewProgress } from "@review/review-api/review-progress";
import {
  type ReactNode,
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

import { AgentSelectionProvider } from "./agent-selection";
import { ApiDocument, type ApiDocumentData } from "./api-document";
import { retainedTrace } from "./api-trace";
import { App, type RenderedReviewDocument } from "./App";
import { AskDesktopSync } from "./ask-dock";
import { AskHistoryProvider } from "./ask-history";
import {
  AskBoardTitleContext,
  AskProjectContext,
  readOpenAsks,
} from "./ask-open-state";
import { BoardCommitsContext } from "./board-commits";
import {
  BoardEditor,
  BoardEditorHostContext,
} from "./board-editor/BoardEditor";
import { CanvasQueryProvider, useCanvasQueryScope } from "./canvas-query";
import { ReviewDebugSettingsProvider } from "./debug-settings";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { CanvasUiContext } from "./host/canvas-ui";
import {
  type ReviewSession,
  ReviewSessionProvider,
  createReviewSession,
  hostApiClient,
  useReviewSession,
} from "./host/review-session";
import { checkoutUnavailable } from "./missing-checkout-banner";
import { ReviewProvider } from "./review-context";
import { ReviewDiffFilesProvider } from "./review-diff-files-context";
import { ReviewDocumentBoundary } from "./review-document-boundary";
import { reportReviewDocumentRenderError } from "./review-document-error-report";
import type { ReviewTocEntry } from "./review-document-headings";
import { type ReviewFindHost, ReviewFindProvider } from "./review-find";
import { ReviewLensesProvider } from "./review-lenses";
import { ReviewPanelProvider, useReviewPanelStore } from "./review-panel";
import { ReviewRootsProvider } from "./review-root-context";
import { readReviewNavigationRestore } from "./review-view-state";

/** A loaded board, ready to draw, and the facts about it. */
export interface WhiteboardData extends ApiDocumentData {
  /** The version pinned on screen; undefined follows the latest. */
  version?: number;
  /** The board's project: its boards share the threads on screen. */
  projectId?: string;
  /** The remote host the board lives on. */
  host?: string;
  hostState?: ReviewApiSummary["hostState"];
  available?: ReviewApiSummary["available"];
  /** The board editor's Contents, as the person types. */
  contents?: ReviewTocEntry[];
  /** Bumped as coverage changes, to read the progress again. */
  coverageRevision?: number;
  /** The progress as loaded, where the host cannot read it. */
  progress?: ReviewProgress;
}

/** What the host can do for the board. Features follow its methods. */
export interface WhiteboardHost extends ReviewCanvasBridge {
  find?: ReviewFindHost;
}

export type WhiteboardSettings = ReviewCanvasSettings;

const BoardData = createContext<WhiteboardData | null>(null);

const BoardSettings = createContext<WhiteboardSettings>({});

/**
 * What the top bar and the board share: the session, the panel store, the
 * review context and find. Both render anywhere under it.
 */
export function WhiteboardProvider({
  data,
  host,
  settings,
  children,
}: {
  data: WhiteboardData;
  host: WhiteboardHost;
  settings: WhiteboardSettings;
  children: ReactNode;
}) {
  const { snapshot } = data;
  const pins = snapshot.pins;
  const client = useMemo(() => hostApiClient(host), [host.request]);
  const session = useBoardSession(data, host, client);
  const queries = useCanvasQueryScope(host.request, snapshot.reviewId);

  useEffect(() => host.ready(), [host.ready]);

  const boardCommits = useMemo(
    () => (pins ? [pins.head, pins.base] : []),
    [pins],
  );

  const appRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const scrollRegionRef = useRef<HTMLElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);

  const roots = useMemo(
    () => ({ appRef, shellRef, scrollRegionRef, articleRef }),
    [],
  );

  const softwareMapEnabled = settings.softwareMapEnabled === true;
  const mapsShown = softwareMapEnabled && data.maps.size > 0;
  const title = boardTitle(snapshot.title);

  return (
    <CanvasQueryProvider scope={queries}>
      <ReviewSessionProvider session={session}>
        <AskProjectContext.Provider value={data.projectId}>
          <AskBoardTitleContext.Provider value={title}>
            <ReviewPanelProvider
              restore={() => ({
                asks: readOpenAsks(session, data.projectId),
                ...readReviewNavigationRestore(session, {
                  softwareMapEnabled:
                    softwareMapEnabled &&
                    elements(snapshot.document).some(
                      (node) => node.type === "software_map",
                    ),
                  hasChangeRange: (pins?.base ?? "") !== (pins?.head ?? ""),
                  version: snapshot.version,
                  commits: data.commits,
                }),
              })}
            >
              <BoardCommitsContext.Provider value={boardCommits}>
                <BoardData.Provider value={data}>
                  <DisplayedReviewVersionContext.Provider
                    value={snapshot.version}
                  >
                    <BoardSettings.Provider value={settings}>
                      <ReviewLensesProvider
                        client={client}
                        snapshot={snapshot}
                        coverageRevision={data.coverageRevision}
                        loaded={data.progress}
                      >
                        <ReviewDiffFilesProvider
                          documentKey={`/\0review:${snapshot.reviewId}`}
                          revision={pins?.worktreeRevision}
                          unavailable={!!snapshot.sourceUnavailable}
                        >
                          <ReviewRootsProvider roots={roots}>
                            <ReviewFindProvider
                              articleRef={articleRef}
                              documentKey={snapshot.reviewId}
                              host={host.find}
                            >
                              <ReviewDebugSettingsProvider>
                                <BoardReview softwareMapEnabled={mapsShown}>
                                  <AskHistoryProvider>
                                    <AskDesktopSync />
                                    <AgentSelectionProvider
                                      revision={snapshot.reviewId}
                                    >
                                      {children}
                                    </AgentSelectionProvider>
                                  </AskHistoryProvider>
                                </BoardReview>
                              </ReviewDebugSettingsProvider>
                            </ReviewFindProvider>
                          </ReviewRootsProvider>
                        </ReviewDiffFilesProvider>
                      </ReviewLensesProvider>
                    </BoardSettings.Provider>
                  </DisplayedReviewVersionContext.Provider>
                </BoardData.Provider>
              </BoardCommitsContext.Provider>
            </ReviewPanelProvider>
          </AskBoardTitleContext.Provider>
        </AskProjectContext.Provider>
      </ReviewSessionProvider>
    </CanvasQueryProvider>
  );
}

/** The session the board and its bar read: the host, and the board as
 * loaded. Its reads go through the host's request. */
function useBoardSession(
  data: WhiteboardData,
  host: WhiteboardHost,
  client: ReviewApiClient,
): ReviewSession {
  const reviewId = data.snapshot.reviewId;
  const latest = useRef(data);
  latest.current = data;
  const ui = useContext(CanvasUiContext);

  const base = useMemo(() => {
    const session = createReviewSession(host, {
      jsonReview: {
        id: reviewId,
        version: () => latest.current.snapshot.version,
      },
    });

    session.softwareMapData = (model) =>
      [...latest.current.maps.values()].find((map) => map === model)
        ?.pinnedData;

    return session;
  }, [host, reviewId]);

  return useMemo(() => {
    const { snapshot, version } = data;

    return {
      ...base,
      review: {
        trashedAt: snapshot.trashedAt,
        reviewId,
        host: data.host,
        hostState: data.hostState,
        hosts: host.remoteHosts,
        available: data.available,
        pins: snapshot.pins
          ? { base: snapshot.pins.base, head: snapshot.pins.head }
          : undefined,
        targetKind: snapshot.target?.kind,
        historicalRevision: version === undefined ? null : String(version),
        updatedAtMs: Date.parse(snapshot.createdAt),
        headBranch: snapshot.origin?.branch,
        baseRef:
          snapshot.origin?.baseBranch ??
          snapshot.origin?.baseRef ??
          (snapshot.target && "base" in snapshot.target
            ? snapshot.target.base
            : undefined),
        headRef:
          snapshot.target?.kind === "commits"
            ? snapshot.target.head
            : undefined,
        pullRequestNumber: snapshot.origin?.pullRequestNumber,
        pullRequestUrl: snapshot.origin?.pullRequestUrl,
        traces: new Map(
          [...data.traces].map(([id, trace]) => [id, retainedTrace(id, trace)]),
        ),
        place: async (signal?: AbortSignal) =>
          parseReviewBoardPlace(
            await client.read(`/${reviewId}/place`, signal),
          ),
        stack: async (signal?: AbortSignal) =>
          parseReviewStackResponse(
            await client.read(
              `/${reviewId}/stack?version=${snapshot.version}`,
              signal,
            ),
          ),
        createBranchReview: async (
          branch: string,
          baseRef: string,
          title: string,
        ) =>
          (
            await client.post<{ reviewId: string }>("/commands", {
              operation: {
                type: "create",
                title,
                target: {
                  kind: "commits",
                  repositoryId: snapshot.pins!.repositoryId,
                  head: branch,
                  base: baseRef,
                },
              },
            })
          ).reviewId,
        dismiss: async () => {
          if (
            ui?.confirmDelete &&
            !(await ui.confirmDelete([snapshot.title], {
              reviewIds: [reviewId],
              trash: true,
            }))
          )
            return false;

          await client.personCommand({
            type: "lifecycle",
            reviewId,
            state: "trash",
          });

          return true;
        },
      },
    };
  }, [base, client, data, host.remoteHosts, reviewId, ui]);
}

function BoardReview({
  softwareMapEnabled,
  children,
}: {
  softwareMapEnabled: boolean;
  children: ReactNode;
}) {
  const panelStore = useReviewPanelStore();

  return (
    <ReviewProvider
      documentRoute="/"
      softwareMapEnabled={softwareMapEnabled}
      openTraceSession={panelStore.getState().openTrace}
    >
      {children}
    </ReviewProvider>
  );
}

/** The board under the nearest `WhiteboardProvider`. */
export function useWhiteboardData(): WhiteboardData {
  const data = useContext(BoardData);

  if (!data) throw new Error("Render under a WhiteboardProvider.");

  return data;
}

// A stable component type keeps sections, diagram tours and selections mounted.
function DocumentBody() {
  const data = useWhiteboardData();
  const session = useReviewSession();
  const softwareMapEnabled = useContext(BoardSettings).softwareMapEnabled;
  const editing = useContext(BoardEditorHostContext) !== null;

  // App keys its boundary on the review id; this one recovers on the next version.
  return (
    <ReviewDocumentBoundary
      session={session}
      revision={`${data.snapshot.reviewId}:${data.snapshot.version}:${data.snapshot.pins?.worktreeRevision ?? ""}`}
      onError={(_revision, error) =>
        reportReviewDocumentRenderError(session, error)
      }
    >
      {editing ? (
        <BoardEditor
          data={data}
          softwareMapEnabled={softwareMapEnabled === true}
        />
      ) : (
        <ApiDocument
          data={data}
          softwareMapEnabled={softwareMapEnabled === true}
        />
      )}
    </ReviewDocumentBoundary>
  );
}

/**
 * The board under the nearest `WhiteboardProvider`: its views, rails, Ask
 * and peeks. Activity updates only the badge, so it redraws only when the
 * board does.
 */
export const Whiteboard = memo(function Whiteboard() {
  const data = useWhiteboardData();
  const settings = useContext(BoardSettings);
  const host = useReviewSession().review?.host;
  const snapshot = data.snapshot;

  const document: RenderedReviewDocument = {
    key: snapshot.reviewId,
    routePath: "/",
    filePath: `review:${snapshot.reviewId}`,
    documentSoftwareModels: [...data.maps.values()],
    anchors: data.anchors,
    render: DocumentBody,
    tocEntries: data.contents ?? data.headings.entries,
    empty: snapshot.document.length === 0,
    header: true,
    databaseLens: elements(snapshot.document).some(
      (node) => node.type === "database_lens",
    ),
    width: settings.documentWidth,
  };

  return (
    <App
      document={document}
      softwareMap={{
        head:
          [...data.maps.values()].find(
            (map) => map.pinnedData.side === "head",
          ) ?? null,
        base:
          [...data.maps.values()].find(
            (map) => map.pinnedData.side === "base",
          ) ?? null,
      }}
      softwareMapEnabled={
        settings.softwareMapEnabled === true && data.maps.size > 0
      }
      // A document without pins of its own has no change range: the Diff and
      // Commits views hide, as for a review whose base is its head.
      range={{
        sourceUnavailable: snapshot.sourceUnavailable
          ? checkoutUnavailable(host)
          : undefined,
        baseRef: snapshot.pins?.base ?? "",
        headRef: snapshot.pins?.head ?? "",
        baseCommit: snapshot.pins?.base ?? "",
        headCommit: snapshot.pins?.head ?? "",
        worktreeRevision: snapshot.pins?.worktreeRevision,
      }}
      commits={data.commits}
    />
  );
});
