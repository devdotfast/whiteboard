import { fontSize, leading, space } from "@canvas/scale.stylex";
import {
  type ReviewCanvasContent,
  type ReviewCanvasSettings,
  type ReviewDiffViewSpec,
  type ReviewInlineEditorSpec,
  boardTitle,
  resolveReviewSourceView,
} from "@dev.fast/review-protocol";
import type { ActivitySnapshot } from "@review/review-api/activity";
import {
  type ReviewApiClient,
  ReviewApiError,
} from "@review/review-api/client";
import type { Snapshot } from "@review/review-api/store";
import * as stylex from "@stylexjs/stylex";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { type ApiDocumentData, createDocumentLoader } from "./api-document";
import { AuthoringActivityContext } from "./authoring-activity-context";
import {
  type AuthoringCursor,
  type CursorMemory,
  nextCursor,
} from "./authoring-cursor";
import { SaveMarkdown } from "./blocks";
import {
  type BoardEditorHost,
  BoardEditorHostContext,
} from "./board-editor/BoardEditor";
import { BoardPaintedContext } from "./board-painted";
import {
  CanvasQueryProvider,
  SharedCanvasQueryClient,
  canvasQueryKeys,
  useCanvasQueryScope,
} from "./canvas-query";
import { ConnectionContext, HostWaiting } from "./connection-chip";
import { DrawQueueProvider } from "./draw-queue-provider";
import { hostApiClient, useReviewSession } from "./host/review-session";
import { useBoardPlace } from "./review-doc-meta";
import type { ReviewTocEntry } from "./review-document-headings";
import type { ReviewFindHost } from "./review-find";
import { SharingContext } from "./share-control";
import { tokens } from "./tokens.stylex";
import { Button } from "./ui/button";
import {
  type WhiteboardData,
  type WhiteboardHost,
  WhiteboardProvider,
} from "./whiteboard";

type ApiContent = Extract<ReviewCanvasContent, { kind: "api" }>;

const noSettings: ReviewCanvasSettings = {};

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Desktop's host: follows the board on its stream, loads it, and renders
 * `children`, the top bar and board, under a `WhiteboardProvider`.
 */
export function ApiCanvas({
  content,
  findHost,
  children,
}: {
  content: ApiContent;
  findHost?: ReviewFindHost;
  children: ReactNode;
}) {
  const client = useMemo(() => hostApiClient(content.bridge), [content.bridge]);
  const settings = content.settings ?? noSettings;
  const queries = useCanvasQueryScope(content.bridge.request, content.reviewId);

  const [version, setVersion] = useState(content.version);
  const [coverageRevision, setCoverageRevision] = useState(0);
  const [activity, setActivity] = useState<ActivitySnapshot | "unknown">();
  const [cursor, setCursor] = useState<AuthoringCursor | null>(null);
  const [lensCursor, setLensCursor] = useState<AuthoringCursor | null>(null);
  useEffect(() => setVersion(content.version), [content.version]);

  const loader = useMemo(
    () => createDocumentLoader(client, queries.queryClient),
    [client, queries],
  );

  useEffect(() => () => loader.dispose(), [loader]);

  const sourceRef = useRef<{ key: string; version: number }>(undefined);

  // Native source widgets must use these pins on their first mount.
  const present = (snapshot: Snapshot, at: number | undefined) => {
    const key = JSON.stringify([
      snapshot.reviewId,
      snapshot.pins,
      at === undefined ? "current" : at,
    ]);

    if (sourceRef.current?.key !== key)
      sourceRef.current = { key, version: snapshot.version };

    content.bridge.setSourceView?.(
      at === undefined
        ? { reviewId: snapshot.reviewId, kind: "current" }
        : { reviewId: snapshot.reviewId, kind: "version", version: at },
      resolveReviewSourceView({
        ...snapshot,
        version: sourceRef.current.version,
      }),
    );
    content.bridge.setTitle?.(boardTitle(snapshot.title));
  };

  const cachedBoard = (at: number | undefined) =>
    queries.queryClient.getQueryData<Snapshot>(
      canvasQueryKeys.board(content.reviewId, at),
    );

  // A board read before draws in its first frame. Its pins reach the host
  // here: children's mount effects run before this one's.
  const drawn = useRef<Snapshot>(undefined);

  const [data, setData] = useState(() => {
    const snapshot = cachedBoard(content.version);

    if (!snapshot) return undefined;
    present(snapshot, content.version);
    drawn.current = snapshot;

    return loader.draft(snapshot);
  });

  const [trashedAt, setTrashedAt] = useState(drawn.current?.trashedAt ?? null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const sourceVersion = sourceRef.current?.key;
  const [error, setError] = useState<string>();
  const [lost, setLost] = useState<string>();
  useEffect(() => {
    const { queryClient } = queries;
    const abort = new AbortController();
    // The last board's cleanup may have dropped this one's snapshot since.
    const cached = drawn.current ?? cachedBoard(version);

    drawn.current = undefined;

    if (!cached) setData(undefined);
    setTrashedAt(cached?.trashedAt ?? null);
    setLost(undefined);
    setActivity(undefined);
    setCursor(null);
    setLensCursor(null);
    // One stream, two couriers: each scope folds its own edits and focus.
    const cursorMemory: CursorMemory = {};
    const lensMemory: CursorMemory = {};

    // Only the shown snapshot's reads draw.
    let current: Snapshot | undefined;

    const update = (next: ApiDocumentData) => {
      if (next.snapshot === current) setData(next);
    };

    const show = async (snapshot: Snapshot) => {
      current = snapshot;

      try {
        queryClient.setQueryData(
          canvasQueryKeys.board(snapshot.reviewId, version),
          snapshot,
        );
        setTrashedAt(snapshot.trashedAt ?? null);
        present(snapshot, version);

        if (dataRef.current?.snapshot !== snapshot)
          setData(loader.draft(snapshot));
        setError(undefined);
        update(await loader.load(snapshot, update));
      } catch (cause) {
        // A document problem: the stream stays healthy.
        if (current === snapshot) setError(message(cause));
      }
    };

    void (async () => {
      const shownOf = (snapshot: Snapshot) =>
        `${snapshot.version}:${snapshot.pins?.worktreeRevision ?? ""}:${snapshot.sourceUnavailable ?? false}:${snapshot.trashedAt ?? ""}`;

      if (cached) void show(cached);
      else if (version !== undefined) {
        try {
          void show(
            await client.read(
              `/${content.reviewId}?full=true&version=${version}`,
              abort.signal,
            ),
          );
        } catch (cause) {
          if (!abort.signal.aborted) setError(message(cause));
        }
      }

      let shownVersion = cached && shownOf(cached);
      let shownLinks = 0;
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

          const placeRevision = canvasQueryKeys.placeRevision(content.reviewId);

          if (place !== queryClient.getQueryData(placeRevision)) {
            queryClient.setQueryData(placeRevision, place);
            void queryClient.invalidateQueries({
              queryKey: canvasQueryKeys.allPlace(content.reviewId),
            });
          }

          if (version !== undefined) return;

          const shown = shownOf(snapshot);
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

          shownVersion = shown;
          shownLinks = links;
          void show(snapshot);
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
      current = undefined;

      if (version === undefined) unfollowed(queryClient, content.reviewId);
    };
  }, [client, content.reviewId, version, queries, loader]);

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

  const host = useMemo<WhiteboardHost>(
    () => ({
      ...content.bridge,
      ...nativeSources,
      find: findHost,
      post: async (request) => {
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
    }),
    [content.bridge, nativeSources, findHost],
  );

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

  // Set once the board has painted.
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    if (data) setPainted(true);
  }, [Boolean(data)]);

  const sharing = useMemo(
    () =>
      data &&
      settings.sharingEnabled === true &&
      !content.host &&
      !data.snapshot.trashedAt
        ? {
            client,
            reviewId: content.reviewId,
            version: data.snapshot.version,
            sender: data.snapshot.shared?.login,
          }
        : null,
    [client, content.reviewId, settings.sharingEnabled, content.host, data],
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

  const remoteHost = content.host;
  const { remoteHosts } = content.bridge;

  const connection = useMemo(
    () =>
      lost === undefined
        ? undefined
        : {
            host: remoteHost,
            hosts: remoteHosts,
            detail: lost,
            reconnect: () => client.reconnect(),
          },
    [lost, remoteHost, remoteHosts, client],
  );

  const contents =
    editorHost && editorToc && editorToc.reviewId === data?.snapshot.reviewId
      ? editorToc.entries
      : undefined;

  const board = useMemo<WhiteboardData | undefined>(
    () =>
      data && {
        ...data,
        version,
        projectId: content.projectId,
        host: content.host,
        hostState: content.hostState,
        available: content.available,
        contents,
        coverageRevision,
      },
    [
      data,
      version,
      content.projectId,
      content.host,
      content.hostState,
      content.available,
      contents,
      coverageRevision,
    ],
  );

  // Loads are near-instant, so stay blank until there is data or an error.
  // Both branches root the same query provider, so its cache outlives a load.
  // Without data there is no top bar for the connection chip.
  if (!board)
    return (
      <CanvasQueryProvider scope={queries}>
        {trashBanner}
        {error === undefined && remoteHost && remoteHosts ? (
          <HostWaiting
            host={remoteHost}
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

  return (
    <div {...stylex.props(styles.canvasSurface)}>
      <CanvasQueryProvider scope={queries}>
        <SharedCanvasQueryClient.Provider value={queries.queryClient}>
          <SharingContext.Provider value={sharing}>
            <ConnectionContext.Provider value={connection}>
              <AuthoringActivityContext.Provider
                value={version === undefined ? activity : undefined}
              >
                <DrawQueueProvider
                  cursor={version === undefined ? cursor : undefined}
                >
                  <DrawQueueProvider
                    scope="lenses"
                    cursor={version === undefined ? lensCursor : undefined}
                  >
                    <SaveMarkdown.Provider value={saveMarkdown}>
                      <BoardPaintedContext.Provider value={painted}>
                        <BoardEditorHostContext.Provider value={editorHost}>
                          <WhiteboardProvider
                            data={board}
                            host={host}
                            settings={settings}
                          >
                            {error && (
                              <p {...stylex.props(styles.error)} role="status">
                                {error}
                              </p>
                            )}
                            {trashBanner}
                            <div {...stylex.props(styles.canvasFrame)}>
                              {version === undefined && (
                                <NearbyBoards
                                  painted={painted}
                                  client={client}
                                  loader={loader}
                                />
                              )}
                              {children}
                            </div>
                          </WhiteboardProvider>
                        </BoardEditorHostContext.Provider>
                      </BoardPaintedContext.Provider>
                    </SaveMarkdown.Provider>
                  </DrawQueueProvider>
                </DrawQueueProvider>
              </AuthoringActivityContext.Provider>
            </ConnectionContext.Provider>
          </SharingContext.Provider>
        </SharedCanvasQueryClient.Provider>
      </CanvasQueryProvider>
    </div>
  );
}

/** Drops a board's snapshot once no stream keeps it current. */
function unfollowed(queryClient: QueryClient, reviewId: string) {
  queryClient.removeQueries({
    queryKey: canvasQueryKeys.board(reviewId, undefined),
    exact: true,
  });
}

/** Keeps the boards beside this one cached and current, once it paints. */
function NearbyBoards({
  painted,
  client,
  loader,
}: {
  painted: boolean;
  client: ReviewApiClient;
  loader: ReturnType<typeof createDocumentLoader>;
}) {
  const place = useBoardPlace();
  const board = useReviewSession().reviewId;
  const queryClient = useQueryClient();

  const nearby = [place.parent, ...place.siblings, ...(place.children ?? [])]
    .flatMap((each) => (each && each.reviewId !== board ? [each.reviewId] : []))
    .join(" ");

  useEffect(() => {
    if (!painted || !nearby) return;
    const abort = new AbortController();
    const read = new Map<string, string>();
    let reads = Promise.resolve();

    for (const reviewId of nearby.split(" "))
      void client.follow<Snapshot & { linksRevision?: number }>(
        reviewId,
        abort.signal,
        (snapshot) => {
          queryClient.setQueryData(
            canvasQueryKeys.board(reviewId, undefined),
            snapshot,
          );
          // Activity alone sends the board again; it changes no reads.
          const key = `${snapshot.version}:${snapshot.linksRevision ?? 0}`;

          if (read.get(reviewId) === key) return;
          read.set(reviewId, key);
          reads = reads.then(() =>
            loader.load(snapshot).then(
              () => {},
              () => {},
            ),
          );
        },
        () => unfollowed(queryClient, reviewId),
      );

    return () => {
      abort.abort();

      for (const reviewId of nearby.split(" "))
        unfollowed(queryClient, reviewId);
    };
  }, [painted, nearby, client, loader, queryClient]);

  return null;
}

const styles = stylex.create({
  canvasSurface: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  canvasFrame: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minHeight: 0,
  },
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
