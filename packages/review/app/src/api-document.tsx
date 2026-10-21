import {
  type ReviewCommitSummary,
  boardTitle,
} from "@dev.fast/review-protocol";
import { type DiffSelection } from "@review/lens-selection";
import type { ReviewApiClient } from "@review/review-api/client";
import {
  type Block,
  type BoardRef,
  boardLinks,
  boardRepositoryId,
  elements,
  resourceReferences,
  selectionReferences,
} from "@review/review-api/document";
import type { LocalReviewData } from "@review/review-api/local-data";
import type { Snapshot } from "@review/review-api/store";
import { VersionCache } from "@review/review-api/version-cache";
import type { NormalizedSoftwareModel } from "@review/software-map-model";
import * as stylex from "@stylexjs/stylex";
import type { QueryClient } from "@tanstack/react-query";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { agentColor } from "./agent-colors";
import { markdownHasTitle } from "./agent-markdown";
import { type ApiHeadingIds, apiHeadingIds } from "./api-document-headings";
import { AuthoringActivityContext } from "./authoring-activity-context";
import {
  type AuthoringCursor,
  scopeLive,
  scopePresence,
} from "./authoring-cursor";
import {
  BlockErrorBoundary,
  type StoredBlock,
  renderBlock,
  stored,
} from "./blocks";
import type { BoardLinkTarget } from "./board-link";
import { AuthoringCursorContext, Courier } from "./courier";
import { documentStyles } from "./document-styles";
import { withErasedBlocks } from "./draw-queue";
import { useMotionPhase, useMotionPhases } from "./draw-queue-provider";
import { drawStyles } from "./draw-styles";
import { useReviewSession } from "./host/review-session";
import { documentNodeMarker, proseMarker } from "./markers.stylex";
import { reportReviewDocumentRenderError } from "./review-document-error-report";
import { ReviewDocumentTitle } from "./review-document-surface";
import { cssIdentifier, scrollToReviewHeading } from "./review-heading-scroll";
import type { SourcePeekAnchor } from "./review-panel-model";
import { useReviewRoots } from "./review-root-context";
import type { SoftwareMapResolvedDataPayload } from "./software-map/software-map-snapshot";

export interface BoardTrace {
  label: string;
  events: { id: string; role: string; text: string }[];
}

export interface ApiDocumentData {
  snapshot: Snapshot;
  headings: ApiHeadingIds;
  /** Undefined until read. */
  commits?: ReviewCommitSummary[];
  anchors: Map<string, SourcePeekAnchor>;
  images: Map<string, string>;
  traces: Map<string, BoardTrace>;
  /** Board link targets, keyed "<boardId>#<blockId>". */
  boards: Map<string, BoardLinkTarget>;
  maps: Map<
    string,
    NormalizedSoftwareModel & {
      pinnedData: SoftwareMapResolvedDataPayload & {
        side: "base" | "head";
        diagramId?: string;
      };
    }
  >;
}

// Reopening a board parses its Markdown again only if the document changed.
// The key includes a hash of the document: serializing and hashing it takes
// 1–2 ms on a 300 KB board.
const derivations = new VersionCache(
  (snapshot: Snapshot) => ({
    headings: apiHeadingIds(snapshot.document),
    references: selectionReferences(snapshot.document, {
      tolerant: true,
      repositoryId: boardRepositoryId(snapshot),
    }),
    resources: resourceReferences(snapshot.document),
  }),
  { capacity: 32, key: documentKey },
);

// A draft runs as each read lands; hash each snapshot once.
const documentKeys = new WeakMap<Snapshot, string>();

function documentKey(snapshot: Snapshot): string {
  const known = documentKeys.get(snapshot);

  if (known) return known;
  const text = JSON.stringify(snapshot.document);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);

  const key = `${snapshot.reviewId}\0${snapshot.version}\0${text.length}\0${hash >>> 0}`;

  documentKeys.set(snapshot, key);

  return key;
}

export type SavedMap = Awaited<ReturnType<LocalReviewData["map"]>>;

type MapModel =
  ApiDocumentData["maps"] extends Map<string, infer Model> ? Model : never;

/** A saved software map, as the board draws it. */
export function savedMapModel(saved: SavedMap): MapModel {
  return {
    ...saved,
    pinnedData: {
      side: saved.side,
      counts: new Map(Object.entries(saved.countsByElementPath)),
      unmappedByElementPath: new Map(
        Object.entries(saved.unmappedByElementPath),
      ),
    },
    elementsByPath: new Map(
      saved.elements.map((element) => [element.path, element]),
    ),
  };
}

type LinkTarget = BoardLinkTarget & { to: BoardRef };

/** Drafts a board from cached reads and reads the rest into the client. */
export function createDocumentLoader(
  client: ReviewApiClient,
  queryClient: QueryClient,
) {
  const urls = new Map<Blob, string>();

  const cached = <T,>(key: string) =>
    queryClient.getQueryData<T>(["document", key]);

  const read = <T,>(
    key: string,
    queryFn: () => Promise<T>,
    staleTime = Infinity,
  ) =>
    queryClient.fetchQuery({ queryKey: ["document", key], queryFn, staleTime });

  const url = (blob: Blob) => {
    let url = urls.get(blob);

    if (!url) {
      url = URL.createObjectURL(blob);
      urls.set(blob, url);
    }

    return url;
  };

  // Per board: the server checks each read against its board.
  const keys = ({ reviewId, version, pins }: Snapshot) => ({
    commits: `${reviewId}:commits:${JSON.stringify(pins)}`,
    links: `${reviewId}:links:${version}`,
    image: (assetId: string) => `${reviewId}:image:${assetId}`,
    trace: (traceId: string) => `${reviewId}:trace:${traceId}`,
    map: (mapVersionId: string) =>
      `${reviewId}:map:${mapVersionId}:${JSON.stringify(pins ?? null)}`,
  });

  const readsCommits = (snapshot: Snapshot) =>
    !snapshot.sourceUnavailable && snapshot.pins !== undefined;

  /** The board with whatever has been read so far. */
  const draft = (snapshot: Snapshot): ApiDocumentData => {
    const { headings, references, resources } = derivations.get(snapshot);
    const key = keys(snapshot);
    const boards: ApiDocumentData["boards"] = new Map();

    for (const link of cached<LinkTarget[]>(key.links) ?? [])
      boards.set(`${link.to.board}#${link.to.block ?? ""}`, link);

    const data: ApiDocumentData = {
      snapshot,
      headings,
      commits: readsCommits(snapshot)
        ? cached<ReviewCommitSummary[]>(key.commits)
        : [],
      anchors: new Map(),
      images: new Map(),
      traces: new Map(),
      boards,
      maps: new Map(),
    };

    for (const { id, source, label } of references) {
      if (snapshot.staleSources?.includes(id)) continue;
      data.anchors.set(
        id,
        sourceAnchor(
          id,
          source,
          label ?? `${source.file}:${source.start.line}`,
        ),
      );
    }

    for (const node of resources) {
      if (node.type === "image") {
        const blob = cached<Blob>(key.image(node.assetId));

        if (blob) data.images.set(node.assetId, url(blob));
      }

      if (node.type === "trace_quote") {
        const trace = cached<BoardTrace | null>(key.trace(node.traceId));

        if (trace) data.traces.set(node.traceId, trace);
      }

      if (node.type === "software_map" && !data.maps.has(node.mapVersionId)) {
        const model = cached<MapModel>(key.map(node.mapVersionId));

        if (model)
          data.maps.set(node.mapVersionId, {
            ...model,
            pinnedData: { ...model.pinnedData, diagramId: node.id },
          });
      }
    }

    return data;
  };

  // Read again each time; on failure, links render without targets.
  const readLinks = (snapshot: Snapshot) =>
    boardLinks(snapshot.reviewId, snapshot.document).length
      ? read(
          keys(snapshot).links,
          async () =>
            (
              await client
                .read<{ outgoing: LinkTarget[] }>(
                  `/${encodeURIComponent(snapshot.reviewId)}/links?version=${snapshot.version}`,
                )
                .catch(() => ({ outgoing: [] }))
            ).outgoing,
          0,
        )
      : undefined;

  const reads = (snapshot: Snapshot) => {
    const { resources } = derivations.get(snapshot);
    const key = keys(snapshot);
    const pending: (Promise<unknown> | undefined)[] = [readLinks(snapshot)];

    if (readsCommits(snapshot))
      pending.push(
        read(key.commits, () =>
          client.read<ReviewCommitSummary[]>(
            `/${snapshot.reviewId}/commits?version=${snapshot.version}`,
          ),
        ),
      );

    for (const node of resources) {
      if (node.type === "image")
        pending.push(
          read(key.image(node.assetId), async () =>
            (
              await client.response(
                `/${encodeURIComponent(snapshot.reviewId)}/resources/${encodeURIComponent(node.assetId)}`,
              )
            ).blob(),
          ),
        );

      // A trace that cannot be loaded leaves its quote to render as text.
      if (node.type === "trace_quote")
        pending.push(
          read(key.trace(node.traceId), () =>
            client
              .read<BoardTrace>(
                `/${encodeURIComponent(snapshot.reviewId)}/resources/${encodeURIComponent(node.traceId)}`,
              )
              .catch(() => null),
          ),
        );

      if (node.type === "software_map")
        pending.push(
          read(key.map(node.mapVersionId), async () =>
            savedMapModel(
              await client.read<SavedMap>(
                `/${snapshot.reviewId}/maps/${encodeURIComponent(node.mapVersionId)}?version=${snapshot.version}`,
              ),
            ),
          ),
        );
    }

    return pending;
  };

  return {
    draft,
    dispose() {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
    /** Reads the rest; `update` takes each partial board. */
    async load(
      snapshot: Snapshot,
      update?: (data: ApiDocumentData) => void,
    ): Promise<ApiDocumentData> {
      await Promise.all(
        reads(snapshot).map((each) =>
          each?.then(() => update?.(draft(snapshot))),
        ),
      );

      return draft(snapshot);
    },
    /** The same document, after a board it links to changed. */
    async relink(data: ApiDocumentData): Promise<ApiDocumentData> {
      await readLinks(data.snapshot);

      return draft(data.snapshot);
    },
  };
}

export function sourceAnchor(
  id: string,
  source: DiffSelection,
  title: string,
): SourcePeekAnchor {
  return { id, title, peek: source };
}

export const documentHasTitle = (document: Snapshot["document"]) =>
  elements(document).some(
    (node) => node.type === "markdown" && markdownHasTitle(node.markdown),
  );

export function ApiDocument({
  data,
  softwareMapEnabled = true,
}: {
  data: ApiDocumentData;
  softwareMapEnabled?: boolean;
}) {
  useHeadingFragments();

  const hasTitle = useMemo(
    () => documentHasTitle(data.snapshot.document),
    [data.snapshot.document],
  );

  const region = useEditingRegion(data.snapshot.document);

  return (
    <>
      {!hasTitle && (
        <ReviewDocumentTitle>
          {boardTitle(data.snapshot.title)}
        </ReviewDocumentTitle>
      )}
      <DocumentBlocks
        nodes={data.snapshot.document}
        data={data}
        softwareMapEnabled={softwareMapEnabled}
        region={region}
      />
      <Courier />
    </>
  );
}

/** How long after the courier's last move the agent still counts as
 * writing; the courier sits down at the same moment. */
const WRITING_MS = 3000;

const ownBlock = (cursor: AuthoringCursor) => cursor.blockId;

/** The agent's block while the document lease is live; `blockOf` maps the
 * courier to a block. */
export function useEditingBlock(
  blockOf: (cursor: AuthoringCursor) => string | undefined = ownBlock,
): { id: string; writing: boolean; slot?: number } | null {
  const cursor = useContext(AuthoringCursorContext);
  const activity = useContext(AuthoringActivityContext);
  const live = scopeLive(activity, "document");
  const [quietSeq, setQuietSeq] = useState<number>();
  const seq = cursor?.seq;

  useEffect(() => {
    if (seq === undefined) return;
    const timer = setTimeout(() => setQuietSeq(seq), WRITING_MS);

    return () => clearTimeout(timer);
  }, [seq]);

  const id = useMemo(
    () => (cursor ? blockOf(cursor) : undefined),
    [cursor, blockOf],
  );

  if (!live || !cursor || id === undefined) return null;

  return {
    id,
    writing: quietSeq !== cursor.seq,
    slot: scopePresence(activity, "document")?.slot,
  };
}

function useEditingRegion(document: Block[]) {
  const topOf = useCallback(
    (cursor: AuthoringCursor) =>
      document.find((top) =>
        elements([top]).some(
          (node) => node.id === cursor.blockId || node.id === cursor.targetId,
        ),
      )?.id,
    [document],
  );

  return useEditingBlock(topOf);
}

/** Follows a `#fragment` link to one of the document's headings, which can sit
 * in a collapsed section the browser cannot reach; other fragments are left to it. */
function useHeadingFragments(): void {
  const roots = useReviewRoots();

  useEffect(() => {
    const article = roots?.articleRef.current;

    if (!roots || !article) return;

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey)
        return;

      const target = event.target;

      const link =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>('a[href^="#"]')
          : null;

      const id = link?.getAttribute("href")?.slice(1);

      if (!id || !article.querySelector(`#${cssIdentifier(id)}`)) return;
      event.preventDefault();
      scrollToReviewHeading(id, article, roots.scrollRegionRef.current);
    };

    article.addEventListener("click", onClick);

    return () => article.removeEventListener("click", onClick);
  }, [roots]);
}

/**
 * One list of sibling blocks. A block the latest version removed is kept on
 * the board, in its old place, for as long as the draw queue is erasing it;
 * the list remembers the version before so it still has the block to show.
 */
function DocumentBlocks({
  nodes,
  data,
  softwareMapEnabled,
  region,
}: {
  nodes: Block[];
  data: ApiDocumentData;
  softwareMapEnabled: boolean;
  /** Only the top level has a region: the block the agent is editing. */
  region?: { id: string; writing: boolean; slot?: number } | null;
}) {
  const phases = useMotionPhases();
  const previous = useRef(nodes);
  const shown = withErasedBlocks(nodes, previous.current, phases);

  useEffect(() => {
    previous.current = shown;
  });

  return shown.map((node) => (
    <DocumentNode
      key={node.id}
      node={node}
      data={data}
      softwareMapEnabled={softwareMapEnabled}
      region={
        region === undefined
          ? undefined
          : !region || region.id !== node.id
            ? "off"
            : region.writing
              ? "writing"
              : "idle"
      }
      regionSlot={region?.id === node.id ? region?.slot : undefined}
    />
  ));
}

// Memoized: unrelated App renders must not rebuild every block's view models.
export const DocumentNode = memo(function DocumentNode({
  node,
  data,
  softwareMapEnabled,
  region,
  regionSlot,
}: {
  node: Block;
  data: ApiDocumentData;
  softwareMapEnabled: boolean;
  region?: "writing" | "idle" | "off";
  /** The color slot of the agent whose editing ring this block wears. */
  regionSlot?: number;
}) {
  const session = useReviewSession();
  const motion = useMotionPhase(node.id);

  const children = (nodes: Block[]) => (
    <DocumentBlocks
      nodes={nodes}
      data={data}
      softwareMapEnabled={softwareMapEnabled}
    />
  );

  if (node.type === "software_map" && !softwareMapEnabled) return null;

  const block = stored(node);

  const stale =
    block.type !== "section" &&
    selectionReferences([block], {
      tolerant: true,
      repositoryId: boardRepositoryId(data.snapshot),
    }).some((reference) => data.snapshot.staleSources?.includes(reference.id));

  const prose = node.type === "markdown" || node.type === "trace_quote";

  // Document and drawing styles find a block's own elements by its
  // data-review-node-id, and its prose by proseMarker.
  return (
    <div
      {...stylex.props(
        documentNodeMarker,
        prose && proseMarker,
        drawStyles.blockChild,
        motion === "queued" && drawStyles.queued,
        motion === "landing" && drawStyles.landing,
        motion === "rewriting" && drawStyles.rewriting,
        motion === "erasing" && drawStyles.erasing,
        region && drawStyles.region,
        (region === "writing" || region === "idle") && drawStyles.regionOn,
        (region === "writing" || region === "idle") && agentColor(regionSlot),
        region === "writing"
          ? drawStyles.blockPulse
          : motion === "erasing"
            ? drawStyles.blockCollapse
            : motion === "landing" && drawStyles.blockLand,
      )}
      data-review-node-id={node.id}
      data-motion={motion}
      data-region={region}
      data-review-copy-prose={prose || undefined}
    >
      <BlockErrorBoundary
        block={block}
        onError={(error) => reportReviewDocumentRenderError(session, error)}
      >
        {stale ? (
          <p
            role="status"
            {...stylex.props(
              documentStyles.note,
              documentStyles.column,
              drawStyles.blockChild,
            )}
          >
            This source range changed. Update the reference to view it.
          </p>
        ) : (
          renderBlock(block.type, block, data, children)
        )}
      </BlockErrorBoundary>
    </div>
  );
});
