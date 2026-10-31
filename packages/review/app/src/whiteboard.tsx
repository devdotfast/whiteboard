import {
  type ReviewApiSummary,
  type ReviewBoardPlace,
  type ReviewCanvasBridge,
  type ReviewCanvasSettings,
  boardTitle,
  parseReviewBoardPlace,
  parseReviewStackResponse,
} from "@dev.fast/review-protocol";
import { type ActivitySnapshot, elements } from "@dev.fast/whiteboard-document";
import type { ReviewApiClient } from "@review/review-api/client";
import type { ReviewProgress } from "@review/review-api/review-progress";
import {
  type ReactNode,
  Suspense,
  createContext,
  lazy,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { AuthoringActivityContext } from "./authoring-activity-context";
import { type CursorFold, foldCursors } from "./authoring-cursor";
import { BoardCommitsContext } from "./board-commits";
import { BoardEditorHostContext } from "./board-editor/host";
import { CanvasQueryProvider, useCanvasQueryScope } from "./canvas-query";
import { ReviewDebugSettingsProvider } from "./debug-settings";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { DrawQueueProvider } from "./draw-queue-provider";
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
import {
  CanvasRootContainer,
  ReviewRootsProvider,
} from "./review-root-context";
import { readReviewNavigationRestore } from "./review-view-state";
import { BoardSettings } from "./whiteboard-settings";

export interface WhiteboardData extends ApiDocumentData {
  /** The version pinned on screen; undefined follows the latest. */
  version?: number;
  projectId?: string;
  /** The remote host the board lives on. */
  host?: string;
  hostState?: ReviewApiSummary["hostState"];
  available?: ReviewApiSummary["available"];
  /** The board editor's Contents while it is open. */
  contents?: ReviewTocEntry[];
  coverageRevision?: number;
  /** For a host that cannot read it. */
  progress?: ReviewProgress;
  /** For a host that cannot read it. */
  place?: ReviewBoardPlace;
  /** Animates a new version's `lastEdit`; "unknown" once the stream is lost. */
  activity?: ActivitySnapshot | "unknown";
}

export interface WhiteboardHost extends ReviewCanvasBridge {
  find?: ReviewFindHost;
}

export type WhiteboardSettings = ReviewCanvasSettings;

const BoardData = createContext<WhiteboardData | null>(null);

// The document alone: it changes only when the board loads.
const BoardDocument = createContext<ApiDocumentData | null>(null);

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

  const history = data.version !== undefined;
  const activity = history ? undefined : data.activity;
  const [fold, setFold] = useState<CursorFold>();

  const folded =
    activity === undefined
      ? undefined
      : foldCursors(fold, snapshot.reviewId, {
          version: snapshot.version,
          lastEdit: snapshot.lastEdit,
          activity,
        });

  if (folded !== fold) setFold(folded);

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
  const { headings, commits, anchors, images, traces, boards, maps } = data;

  const document = useMemo<ApiDocumentData>(
    () => ({
      snapshot,
      headings,
      commits,
      anchors,
      images,
      traces,
      boards,
      maps,
    }),
    [snapshot, headings, commits, anchors, images, traces, boards, maps],
  );

  return (
    <AuthoringActivityContext.Provider value={activity}>
      <DrawQueueProvider
        cursor={history ? undefined : (folded?.cursors.document ?? null)}
      >
        <DrawQueueProvider
          scope="lenses"
          cursor={history ? undefined : (folded?.cursors.lenses ?? null)}
        >
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
                        hasChangeRange:
                          (pins?.base ?? "") !== (pins?.head ?? ""),
                        version: snapshot.version,
                        commits: data.commits,
                      }),
                    })}
                  >
                    <BoardCommitsContext.Provider value={boardCommits}>
                      <BoardData.Provider value={data}>
                        <BoardDocument.Provider value={document}>
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
                                        <BoardReview
                                          softwareMapEnabled={mapsShown}
                                        >
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
                        </BoardDocument.Provider>
                      </BoardData.Provider>
                    </BoardCommitsContext.Provider>
                  </ReviewPanelProvider>
                </AskBoardTitleContext.Provider>
              </AskProjectContext.Provider>
            </ReviewSessionProvider>
          </CanvasQueryProvider>
        </DrawQueueProvider>
      </DrawQueueProvider>
    </AuthoringActivityContext.Provider>
  );
}

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

  // Not all of `data`: coverage and the editor's headings change often.
  const { snapshot, version, hostState, available, traces, place } = data;
  const remoteHost = data.host;

  return useMemo(() => {
    return {
      ...base,
      review: {
        trashedAt: snapshot.trashedAt,
        reviewId,
        host: remoteHost,
        hostState,
        hosts: host.remoteHosts,
        available,
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
          [...traces].map(([id, trace]) => [id, retainedTrace(id, trace)]),
        ),
        knownPlace: place,
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
                reuseExisting: true,
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
  }, [
    base,
    client,
    snapshot,
    version,
    remoteHost,
    hostState,
    available,
    traces,
    place,
    host.remoteHosts,
    reviewId,
    ui,
  ]);
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

export function useWhiteboardData(): WhiteboardData {
  const data = useContext(BoardData);

  if (!data) throw new Error("Render under a WhiteboardProvider.");

  return data;
}

let boardEditor: typeof import("./board-editor/BoardEditor") | undefined;

/** Read-only hosts never load ProseMirror; Desktop calls this at startup. */
export function preloadBoardEditor() {
  return import("./board-editor/BoardEditor").then(
    (module) => (boardEditor = module),
  );
}

const LazyBoardEditor = lazy(() =>
  preloadBoardEditor().then(({ BoardEditor }) => ({ default: BoardEditor })),
);

// A stable component type keeps sections, diagram tours and selections mounted.
function DocumentBody() {
  const data = useContext(BoardDocument)!;
  const session = useReviewSession();
  const softwareMapEnabled = useContext(BoardSettings).softwareMapEnabled;
  const editing = useContext(BoardEditorHostContext) !== null;

  const [BoardEditor] = useState(
    () => boardEditor?.BoardEditor ?? LazyBoardEditor,
  );

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
        <Suspense fallback={null}>
          <BoardEditor
            data={data}
            softwareMapEnabled={softwareMapEnabled === true}
          />
        </Suspense>
      ) : (
        <ApiDocument
          data={data}
          softwareMapEnabled={softwareMapEnabled === true}
        />
      )}
    </ReviewDocumentBoundary>
  );
}

export function Whiteboard() {
  const data = useWhiteboardData();
  const settings = useContext(BoardSettings);
  const host = useReviewSession().review?.host;

  return (
    <CanvasRootContainer>
      <BoardView
        snapshot={data.snapshot}
        maps={data.maps}
        anchors={data.anchors}
        tocEntries={data.contents ?? data.headings.entries}
        commits={data.commits}
        settings={settings}
        host={host}
      />
    </CanvasRootContainer>
  );
}

// Takes the board's parts so coverage changes leave its inputs as they were.
const BoardView = memo(function BoardView({
  snapshot,
  maps,
  anchors,
  tocEntries,
  commits,
  settings,
  host,
}: Pick<WhiteboardData, "snapshot" | "maps" | "anchors" | "commits"> & {
  tocEntries: ReviewTocEntry[];
  settings: WhiteboardSettings;
  host?: string;
}) {
  const document: RenderedReviewDocument = {
    key: snapshot.reviewId,
    routePath: "/",
    filePath: `review:${snapshot.reviewId}`,
    documentSoftwareModels: [...maps.values()],
    anchors,
    render: DocumentBody,
    tocEntries,
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
          [...maps.values()].find((map) => map.pinnedData.side === "head") ??
          null,
        base:
          [...maps.values()].find((map) => map.pinnedData.side === "base") ??
          null,
      }}
      softwareMapEnabled={settings.softwareMapEnabled === true && maps.size > 0}
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
      commits={commits}
    />
  );
});
