import {
  type ReviewDocumentWidthChoice,
  boardTitle,
} from "@dev.fast/review-protocol";
import { elements } from "@review/review-api/document";
import {
  type ReactNode,
  createContext,
  memo,
  useContext,
  useMemo,
  useRef,
} from "react";

import { AgentSelectionProvider } from "./agent-selection";
import { ApiDocument, type ApiDocumentData } from "./api-document";
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
import { ReviewDebugSettingsProvider } from "./debug-settings";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import {
  type ReviewSession,
  ReviewSessionProvider,
  useReviewSession,
} from "./host/review-session";
import { checkoutUnavailable } from "./missing-checkout-banner";
import { ReviewProvider } from "./review-context";
import { ReviewDiffFilesProvider } from "./review-diff-files-context";
import { ReviewDocumentBoundary } from "./review-document-boundary";
import { reportReviewDocumentRenderError } from "./review-document-error-report";
import type { ReviewTocEntry } from "./review-document-headings";
import { type ReviewFindHost, ReviewFindProvider } from "./review-find";
import { ReviewPanelProvider, useReviewPanelStore } from "./review-panel";
import { ReviewRootsProvider } from "./review-root-context";
import { readReviewNavigationRestore } from "./review-view-state";

const DocumentData = createContext<ApiDocumentData | null>(null);

const MapEnabled = createContext(false);

/**
 * What the top bar and the board share: the session, the panel store, the
 * review context and find. Both render anywhere under it.
 */
export function WhiteboardProvider({
  session,
  data,
  projectId,
  softwareMapEnabled,
  findHost,
  children,
}: {
  session: ReviewSession;
  data: ApiDocumentData;
  projectId?: string;
  softwareMapEnabled: boolean;
  findHost?: ReviewFindHost;
  children: ReactNode;
}) {
  const { snapshot } = data;
  const pins = snapshot.pins;

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

  const mapsShown = softwareMapEnabled && data.maps.size > 0;
  const title = boardTitle(snapshot.title);

  return (
    <ReviewSessionProvider session={session}>
      <AskProjectContext.Provider value={projectId}>
        <AskBoardTitleContext.Provider value={title}>
          <ReviewPanelProvider
            restore={() => ({
              asks: readOpenAsks(session.config, projectId),
              ...readReviewNavigationRestore(session.config, {
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
              <DocumentData.Provider value={data}>
                <DisplayedReviewVersionContext.Provider
                  value={snapshot.version}
                >
                  <MapEnabled.Provider value={softwareMapEnabled}>
                    <ReviewDiffFilesProvider
                      documentKey={`/\0review:${snapshot.reviewId}`}
                      revision={pins?.worktreeRevision}
                      unavailable={!!snapshot.sourceUnavailable}
                    >
                      <ReviewRootsProvider roots={roots}>
                        <ReviewFindProvider
                          articleRef={articleRef}
                          documentKey={snapshot.reviewId}
                          host={findHost}
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
                  </MapEnabled.Provider>
                </DisplayedReviewVersionContext.Provider>
              </DocumentData.Provider>
            </BoardCommitsContext.Provider>
          </ReviewPanelProvider>
        </AskBoardTitleContext.Provider>
      </AskProjectContext.Provider>
    </ReviewSessionProvider>
  );
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

/** The loaded board under the nearest `WhiteboardProvider`. */
export function useWhiteboardData(): ApiDocumentData {
  const data = useContext(DocumentData);

  if (!data) throw new Error("Render under a WhiteboardProvider.");

  return data;
}

// A stable component type keeps sections, diagram tours and selections mounted.
function DocumentBody() {
  const data = useWhiteboardData();
  const session = useReviewSession();
  const softwareMapEnabled = useContext(MapEnabled);
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
        <BoardEditor data={data} softwareMapEnabled={softwareMapEnabled} />
      ) : (
        <ApiDocument data={data} softwareMapEnabled={softwareMapEnabled} />
      )}
    </ReviewDocumentBoundary>
  );
}

// Activity updates only the badge; keep diagram inputs stable until document data changes.
export const CanvasDocument = memo(function CanvasDocument({
  documentWidth,
  tocEntries,
}: {
  documentWidth?: ReviewDocumentWidthChoice;
  /** The editor's Contents, when the board is being edited. */
  tocEntries?: ReviewTocEntry[];
}) {
  const data = useWhiteboardData();
  const softwareMapEnabled = useContext(MapEnabled);
  const host = useReviewSession().review?.host;
  const snapshot = data.snapshot;

  const document: RenderedReviewDocument = {
    key: snapshot.reviewId,
    routePath: "/",
    filePath: `review:${snapshot.reviewId}`,
    documentSoftwareModels: [...data.maps.values()],
    anchors: data.anchors,
    render: DocumentBody,
    tocEntries: tocEntries ?? data.headings.entries,
    empty: snapshot.document.length === 0,
    header: true,
    databaseLens: elements(snapshot.document).some(
      (node) => node.type === "database_lens",
    ),
    width: documentWidth,
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
      softwareMapEnabled={softwareMapEnabled && data.maps.size > 0}
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
