import { fontSize, leading, space } from "@canvas/scale.stylex";
import {
  type ReviewCanvasContent,
  type ReviewDiffViewSpec,
  type ReviewDocumentWidthChoice,
  type ReviewInlineEditorSpec,
  boardTitle,
  parseReviewBoardPlace,
  parseReviewStackResponse,
  resolveReviewSourceView,
} from "@dev.fast/review-protocol";
import type { ActivitySnapshot } from "@review/review-api/activity";
import { ReviewApiClient, ReviewApiError } from "@review/review-api/client";
import { elements } from "@review/review-api/document";
import type { Snapshot } from "@review/review-api/store";
import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ApiDocument,
  type ApiDocumentData,
  createDocumentLoader,
  documentHasTitle,
} from "./api-document";
import { retainedTrace } from "./api-trace";
import { App } from "./App";
import type { RenderedReviewDocument } from "./App";
import {
  AskBoardTitleContext,
  AskProjectContext,
  readOpenAsks,
} from "./ask-open-state";
import { AuthoringActivityContext } from "./authoring-activity-context";
import {
  type AuthoringCursor,
  type CursorMemory,
  nextCursor,
} from "./authoring-cursor";
import { SaveMarkdown } from "./blocks";
import { BoardCommitsContext } from "./board-commits";
import {
  BoardEditor,
  type BoardEditorHost,
  BoardEditorHostContext,
} from "./board-editor/BoardEditor";
import { BoardPaintedContext, DrawingContext } from "./board-switch";
import {
  CanvasQueryProvider,
  canvasQueryKeys,
  useCanvasQueryScope,
} from "./canvas-query";
import { ConnectionContext, HostWaiting } from "./connection-chip";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { DrawQueueProvider } from "./draw-queue-provider";
import { CanvasUiContext } from "./host/canvas-ui";
import {
  ReviewSessionProvider,
  createReviewSession,
  useReviewSession,
} from "./host/review-session";
import { checkoutUnavailable } from "./missing-checkout-banner";
import { ReviewDocumentBoundary } from "./review-document-boundary";
import { reportReviewDocumentRenderError } from "./review-document-error-report";
import type { ReviewTocEntry } from "./review-document-headings";
import type { ReviewFindHost } from "./review-find";
import { ReviewLensesProvider } from "./review-lenses";
import { ReviewPanelProvider } from "./review-panel";
import { readReviewNavigationRestore } from "./review-view-state";
import { SharingContext } from "./share-control";
import { tokens } from "./tokens.stylex";
import { Button } from "./ui/button";

type ApiContent = Extract<ReviewCanvasContent, { kind: "api" }>;

const DocumentData = createContext<ApiDocumentData | null>(null);

const MapEnabled = createContext(false);

// A stable component type keeps sections, diagram tours and selections mounted.
function DocumentBody() {
  const data = useContext(DocumentData)!;
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

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function ApiCanvas({
  content,
  findHost,
  held = false,
  onLoaded,
}: {
  content: ApiContent;
  findHost?: ReviewFindHost;
  /** Loading unseen behind the board on screen. */
  held?: boolean;
  /** Its document, or why there is none, is ready to show. */
  onLoaded?(reviewId: string): void;
}) {
  const client = useMemo(
    () => new ReviewApiClient(content.bridge.config, content.bridge.request),
    [content.bridge],
  );

  const queries = useCanvasQueryScope(client, content.reviewId);

  const [version, setVersion] = useState(content.version);
  const [coverageRevision, setCoverageRevision] = useState(0);
  const [activity, setActivity] = useState<ActivitySnapshot | "unknown">();
  const [cursor, setCursor] = useState<AuthoringCursor | null>(null);
  const [lensCursor, setLensCursor] = useState<AuthoringCursor | null>(null);
  useEffect(() => setVersion(content.version), [content.version]);
  const [data, setData] = useState<ApiDocumentData>();
  const [trashedAt, setTrashedAt] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const sourceRef = useRef<{ key: string; version: number }>(undefined);
  const sourceVersion = sourceRef.current?.key;
  const [error, setError] = useState<string>();
  const [lost, setLost] = useState<string>();
  useEffect(() => {
    const { queryClient } = queries;
    const abort = new AbortController();
    const loader = createDocumentLoader(client);
    setData(undefined);
    setTrashedAt(null);
    setLost(undefined);
    setActivity(undefined);
    setCursor(null);
    setLensCursor(null);
    // One stream, two couriers: each scope folds its own edits and focus.
    const cursorMemory: CursorMemory = {};
    const lensMemory: CursorMemory = {};

    const show = async (snapshot: Snapshot) => {
      setTrashedAt(snapshot.trashedAt ?? null);
      const next = await loader.load(snapshot);

      if (abort.signal.aborted) return;

      // Native source widgets must use these pins on their first mount.
      const key = JSON.stringify([
        snapshot.reviewId,
        snapshot.pins,
        version === undefined ? "current" : version,
      ]);

      if (sourceRef.current?.key !== key)
        sourceRef.current = { key, version: snapshot.version };

      content.setSourceView?.(
        version === undefined
          ? { reviewId: snapshot.reviewId, kind: "current" }
          : { reviewId: snapshot.reviewId, kind: "version", version },
        resolveReviewSourceView({
          ...snapshot,
          version: sourceRef.current.version,
        }),
      );
      setData(next);
      setError(undefined);
      content.setTitle?.(boardTitle(snapshot.title));
    };

    void (async () => {
      if (version !== undefined) {
        try {
          await show(
            await client.read(
              `/${content.reviewId}?full=true&version=${version}`,
              abort.signal,
            ),
          );
        } catch (cause) {
          if (!abort.signal.aborted) setError(message(cause));
        }
      }

      let shownVersion: string | undefined;
      let shownLinks = 0;
      let placeRevision = 0;
      await client.follow<
        Snapshot & {
          activity: ActivitySnapshot;
          coverageRevision?: number;
          linksRevision?: number;
          placeRevision?: number;
        }
      >(
        content.reviewId,
        abort.signal,
        async (snapshot) => {
          setLost(undefined);
          setActivity(snapshot.activity);
          setCursor((current) => nextCursor(current, cursorMemory, snapshot));
          setLensCursor((current) =>
            nextCursor(current, lensMemory, snapshot, "lenses"),
          );
          setCoverageRevision(snapshot.coverageRevision ?? 0);
          // A reconnected stream restarts at 0, which also rereads.
          const place = snapshot.placeRevision ?? 0;

          if (place !== placeRevision) {
            placeRevision = place;
            void queryClient.invalidateQueries({
              queryKey: canvasQueryKeys.allPlace(),
            });
          }

          if (version !== undefined) return;

          const shown = `${snapshot.version}:${snapshot.pins?.worktreeRevision ?? ""}:${snapshot.sourceUnavailable ?? false}:${snapshot.trashedAt ?? ""}`;
          const links = snapshot.linksRevision ?? 0;

          if (shownVersion === shown) {
            setError(undefined);

            // A board it links to changed: only its links' targets load again.
            if (links !== shownLinks && dataRef.current) {
              shownLinks = links;
              const next = await loader.relink(dataRef.current);

              if (!abort.signal.aborted) setData(next);
            }

            return;
          }

          try {
            await show(snapshot);
            shownVersion = shown;
            shownLinks = links;
          } catch (cause) {
            // A failed resource or source fetch is a document problem. The
            // stream and the activity signal are still healthy, so do not
            // reconnect or report unknown activity.
            if (!abort.signal.aborted) setError(message(cause));
          }
        },
        (cause) => {
          setActivity("unknown");
          setCursor((current) =>
            current
              ? nextCursor(current, cursorMemory, {
                  version: cursorMemory.version ?? 0,
                  activity: "unknown",
                })
              : current,
          );

          setLensCursor((current) =>
            current
              ? nextCursor(
                  current,
                  lensMemory,
                  {
                    version: lensMemory.version ?? 0,
                    activity: "unknown",
                  },
                  "lenses",
                )
              : current,
          );

          if (
            cause instanceof ReviewApiError &&
            [401, 403, 404].includes(cause.status)
          ) {
            setError(cause.message);

            return;
          }

          setLost(cause instanceof Error ? cause.message : "");
        },
      );
    })();

    return () => {
      abort.abort();
      loader.dispose();
    };
  }, [client, content.reviewId, version, queries]);

  // Read at create, so a host going offline keeps the open editors.
  const openFile = useRef(true);

  openFile.current = content.available?.sourceWindows !== false;

  const nativeSources = useMemo(() => {
    const { inlineEditors, diffView } = content.bridge;

    return {
      inlineEditors: {
        ...inlineEditors,
        create: (spec: ReviewInlineEditorSpec) =>
          inlineEditors.create(
            openFile.current ? spec : { ...spec, onDidOpen: undefined },
          ),
      },
      diffView: {
        ...diffView,
        create: (spec: ReviewDiffViewSpec) =>
          diffView.create(
            openFile.current ? spec : { ...spec, openFile: false },
          ),
      },
    };
  }, [content.bridge, sourceVersion]);

  const baseSession = useMemo(() => {
    const bridge = {
      ...content.bridge,
      ...nativeSources,
      post: async (request: Parameters<ApiContent["bridge"]["post"]>[0]) => {
        if (request.name === "openReviewRevision") {
          setVersion(
            request.args.revision === undefined
              ? undefined
              : Number(request.args.revision),
          );

          return { ok: true as const };
        }

        return content.bridge.post(request);
      },
    };

    const session = createReviewSession(bridge, {
      jsonReview: {
        id: content.reviewId,
        version: () => dataRef.current?.snapshot.version,
      },
    });

    session.softwareMapData = (model) =>
      [...(dataRef.current?.maps.values() ?? [])].find((map) => map === model)
        ?.pinnedData;

    return session;
  }, [content.bridge, content.reviewId, nativeSources]);

  const ui = useContext(CanvasUiContext);

  const session = useMemo(() => {
    if (!data) return baseSession;
    const snapshot = data.snapshot;

    return {
      ...baseSession,
      review: {
        trashedAt: snapshot.trashedAt,
        reviewId: snapshot.reviewId,
        host: content.host,
        hostState: content.hostState,
        hosts: content.remoteHosts,
        available: content.available,
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
            await client.read(`/${snapshot.reviewId}/place`, signal),
          ),
        stack: async (signal?: AbortSignal) =>
          parseReviewStackResponse(
            await client.read(
              `/${snapshot.reviewId}/stack?version=${snapshot.version}`,
              signal,
            ),
          ),
        createBranchReview: async (
          branch: string,
          base: string,
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
                  base,
                },
              },
            })
          ).reviewId,
        dismiss: async () => {
          if (
            ui?.confirmDelete &&
            !(await ui.confirmDelete([snapshot.title], {
              reviewIds: [content.reviewId],
              trash: true,
            }))
          )
            return false;

          await client.personCommand({
            type: "lifecycle",
            reviewId: content.reviewId,
            state: "trash",
          });

          return true;
        },
      },
    };
  }, [
    baseSession,
    client,
    content.reviewId,
    content.host,
    content.hostState,
    content.remoteHosts,
    content.available,
    data,
    version,
    ui,
  ]);

  // Only the latest version of a review this machine owns takes edits.
  const editable =
    version === undefined &&
    data !== undefined &&
    !data.snapshot.shared &&
    !data.snapshot.trashedAt;

  const saveMarkdown = useMemo(
    () =>
      editable
        ? (blockId: string, markdown: string) =>
            // The person's own edit, credited to them.
            void client
              .personCommand({
                type: "edit",
                reviewId: content.reviewId,
                edit: {
                  type: "update",
                  targetId: blockId,
                  changes: { markdown },
                },
              })
              .catch((cause) => setError(message(cause)))
        : undefined,
    [client, content.reviewId, editable],
  );

  // The board editor's Contents, as the person types.
  // Keyed by board: a switch never shows the last board's headings, and
  // until this board's editor reports, Contents is its snapshot's.
  const [editorToc, setEditorToc] = useState<{
    reviewId: string;
    entries: ReviewTocEntry[];
  }>();

  const editorHost = useMemo<BoardEditorHost | null>(
    () =>
      editable
        ? {
            client,
            setHeadings: (entries) =>
              setEditorToc(entries && { reviewId: content.reviewId, entries }),
          }
        : null,
    [client, content.reviewId, editable],
  );

  useEffect(() => {
    if (data && !held) content.bridge.ready();
  }, [Boolean(data), held, content.bridge]);

  // Effects run once the frame that shows the board has painted.
  const [painted, setPainted] = useState(false);
  const shown = data !== undefined && !held;

  useEffect(() => {
    if (shown) setPainted(true);
  }, [shown]);

  // Held, the page bar's place is read first, so it swaps in whole. The
  // page bar reads the same query.
  const [placeRead, setPlaceRead] = useState(false);
  const review = session.review;
  const shownVersion = data?.snapshot.version;

  useEffect(() => {
    if (!held || !review) return;
    let live = true;

    void queries.queryClient
      .fetchQuery({
        queryKey: canvasQueryKeys.place(shownVersion),
        queryFn: ({ signal }) => review.place(signal),
        staleTime: Infinity,
      })
      .catch(() => {})
      .then(() => {
        if (live) setPlaceRead(true);
      });

    return () => {
      live = false;
    };
  }, [held, review, queries, shownVersion]);

  const [drawing, setDrawing] = useState(0);

  const drawingCounter = useMemo(
    () =>
      held
        ? {
            begin() {
              let open = true;
              setDrawing((count) => count + 1);

              return () => {
                if (!open) return;
                open = false;
                setDrawing((count) => count - 1);
              };
            },
          }
        : null,
    [held],
  );

  const loaded =
    (data !== undefined && placeRead && drawing === 0) ||
    (error ?? lost) !== undefined;

  useEffect(() => {
    if (held && loaded) onLoaded?.(content.reviewId);
  }, [held, loaded, onLoaded, content.reviewId]);

  const sharing = useMemo(
    () =>
      data &&
      content.sharingEnabled === true &&
      !content.host &&
      !data.snapshot.trashedAt
        ? {
            client,
            reviewId: content.reviewId,
            version: data.snapshot.version,
            sender: data.snapshot.shared?.login,
          }
        : null,
    [client, content.reviewId, content.sharingEnabled, content.host, data],
  );

  const pins = data?.snapshot.pins;

  const boardCommits = useMemo(
    () => (pins ? [pins.head, pins.base] : []),
    [pins],
  );

  const trashBanner = trashedAt && (
    <div role="status" {...stylex.props(styles.trashBanner)}>
      In Trash ·{" "}
      {Math.min(
        30,
        Math.max(
          0,
          Math.ceil(
            (Date.parse(trashedAt) + 30 * 86400000 - Date.now()) / 86400000,
          ),
        ),
      )}{" "}
      days left
      <Button
        onClick={() =>
          void client
            .personCommand({
              type: "lifecycle",
              state: "active",
              reviewId: content.reviewId,
            })
            .then(() => client.read<Snapshot>(`/${content.reviewId}?full=true`))
            .then((snapshot) => {
              setTrashedAt(snapshot.trashedAt ?? null);
              setData((current) => current && { ...current, snapshot });
            })
            .catch((cause) => setError(message(cause)))
        }
      >
        Restore
      </Button>
    </div>
  );

  const { host, remoteHosts } = content;

  const connection = useMemo(
    () =>
      lost === undefined
        ? undefined
        : {
            host,
            hosts: remoteHosts,
            detail: lost,
            reconnect: () => client.reconnect(),
          },
    [lost, host, remoteHosts, client],
  );

  // Loads are near-instant, so stay blank until there is data or an error.
  // Both branches root the same query provider, so its cache outlives a load.
  // Without data there is no top bar for the connection chip.
  if (!data)
    return (
      <CanvasQueryProvider scope={queries}>
        {trashBanner}
        {error === undefined && host && remoteHosts ? (
          <HostWaiting
            host={host}
            hosts={remoteHosts}
            reconnect={() => client.reconnect()}
            lost={lost}
          />
        ) : (error ?? lost) !== undefined ? (
          <>
            <p {...stylex.props(styles.error)} role="status">
              {error ?? `Connection lost. Reconnecting… ${lost}`}
            </p>
            {version !== undefined && (
              <Button onClick={() => setVersion(undefined)}>
                Back to latest version
              </Button>
            )}
          </>
        ) : null}
      </CanvasQueryProvider>
    );

  const title = boardTitle(data.snapshot.title);

  return (
    <div {...stylex.props(styles.canvasSurface)}>
      <CanvasQueryProvider scope={queries}>
        <SharingContext.Provider value={sharing}>
          <ReviewSessionProvider session={session}>
            <AskProjectContext.Provider value={content.projectId}>
              <AskBoardTitleContext.Provider value={title}>
                <ReviewPanelProvider
                  restore={() => ({
                    asks: readOpenAsks(session.config, content.projectId),
                    ...readReviewNavigationRestore(session.config, {
                      softwareMapEnabled:
                        content.softwareMapEnabled === true &&
                        data.maps.size > 0,
                      hasChangeRange:
                        (data.snapshot.pins?.base ?? "") !==
                        (data.snapshot.pins?.head ?? ""),
                      version: data.snapshot.version,
                      commits: data.commits,
                    }),
                  })}
                >
                  <BoardCommitsContext.Provider value={boardCommits}>
                    <DocumentData.Provider value={data}>
                      <ReviewLensesProvider
                        client={client}
                        snapshot={data.snapshot}
                        coverageRevision={coverageRevision}
                      >
                        {error && (
                          <p {...stylex.props(styles.error)} role="status">
                            {error}
                          </p>
                        )}
                        {trashBanner}
                        <ConnectionContext.Provider value={connection}>
                          <AuthoringActivityContext.Provider
                            value={version === undefined ? activity : undefined}
                          >
                            <DrawQueueProvider
                              cursor={
                                version === undefined ? cursor : undefined
                              }
                            >
                              <DrawQueueProvider
                                scope="lenses"
                                cursor={
                                  version === undefined ? lensCursor : undefined
                                }
                              >
                                <DisplayedReviewVersionContext.Provider
                                  value={data.snapshot.version}
                                >
                                  <MapEnabled.Provider
                                    value={content.softwareMapEnabled === true}
                                  >
                                    <SaveMarkdown.Provider value={saveMarkdown}>
                                      <div
                                        {...stylex.props(styles.canvasFrame)}
                                      >
                                        <BoardPaintedContext.Provider
                                          value={painted}
                                        >
                                          <DrawingContext.Provider
                                            value={drawingCounter}
                                          >
                                            <BoardEditorHostContext.Provider
                                              value={editorHost}
                                            >
                                              <CanvasDocument
                                                data={data}
                                                findHost={findHost}
                                                softwareMapEnabled={
                                                  content.softwareMapEnabled ===
                                                  true
                                                }
                                                documentWidth={
                                                  content.documentWidth
                                                }
                                                tocEntries={
                                                  editorHost &&
                                                  editorToc?.reviewId ===
                                                    data.snapshot.reviewId
                                                    ? editorToc.entries
                                                    : undefined
                                                }
                                              />
                                            </BoardEditorHostContext.Provider>
                                          </DrawingContext.Provider>
                                        </BoardPaintedContext.Provider>
                                      </div>
                                    </SaveMarkdown.Provider>
                                  </MapEnabled.Provider>
                                </DisplayedReviewVersionContext.Provider>
                              </DrawQueueProvider>
                            </DrawQueueProvider>
                          </AuthoringActivityContext.Provider>
                        </ConnectionContext.Provider>
                      </ReviewLensesProvider>
                    </DocumentData.Provider>
                  </BoardCommitsContext.Provider>
                </ReviewPanelProvider>
              </AskBoardTitleContext.Provider>
            </AskProjectContext.Provider>
          </ReviewSessionProvider>
        </SharingContext.Provider>
      </CanvasQueryProvider>
    </div>
  );
}

// Activity updates only the badge; keep diagram inputs stable until document data changes.
const CanvasDocument = memo(function CanvasDocument({
  data,
  findHost,
  softwareMapEnabled,
  documentWidth,
  tocEntries,
}: {
  data: ApiDocumentData;
  findHost?: ReviewFindHost;
  softwareMapEnabled: boolean;
  documentWidth?: ReviewDocumentWidthChoice;
  /** The editor's Contents, when the board is being edited. */
  tocEntries?: ReviewTocEntry[];
}) {
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
      findHost={findHost}
    />
  );
});

const styles = stylex.create({
  canvasSurface: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  canvasFrame: { flex: "1 1 auto", minHeight: 0 },
  trashBanner: {
    display: "flex",
    gap: space.s12,
    alignItems: "center",
    padding: `${space.s10} ${space.s24}`,
    backgroundColor: tokens.tray,
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    flexShrink: 0,
  },
  error: {
    maxWidth: "72ch",
    margin: `${space.s32} auto`,
    padding: `0 ${space.s24}`,
    font: `${fontSize.reading}/${leading.relaxed} ${tokens.chromeFont}`,
  },
});
