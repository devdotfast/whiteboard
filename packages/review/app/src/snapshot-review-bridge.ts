import type {
  JsonValue,
  ReviewCanvasBridge,
  ReviewCommitSummary,
  ReviewDiffFileWire,
  ReviewDiffViewFactory,
  ReviewInlineEditorFactory,
  ReviewRuntimeConfig,
  ReviewStreamLine,
  ReviewTheme,
} from "@dev.fast/review-protocol";
import type { ReviewProgress } from "@review/review-api/review-progress";
import type { Snapshot } from "@review/review-api/store";

/** One saved version of a board and what it reads while mounting. */
export interface SnapshotReviewApi {
  snapshot: Snapshot;
  progress?: ReviewProgress;
  /** Resource id to its JSON body, or to bytes with a content type. */
  resources?: Record<string, JsonValue | SnapshotBytes>;
  maps?: Record<string, JsonValue>;
  commits?: ReviewCommitSummary[];
  files?: ReviewDiffFileWire[];
}

export interface SnapshotBytes {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
}

const isBytes = (value: JsonValue | SnapshotBytes): value is SnapshotBytes =>
  value instanceof Object && "bytes" in value && "type" in value;

export interface SnapshotReviewHost {
  config: ReviewRuntimeConfig;
  inlineEditors: ReviewInlineEditorFactory;
  diffView: ReviewDiffViewFactory;
  theme?: ReviewTheme;
}

/**
 * A bridge that answers the review API from one saved version, with no
 * server. Its watch stream sends that version once, then stays open and
 * quiet, as a board that never changes.
 */
export function snapshotReviewBridge(
  api: SnapshotReviewApi,
  host: SnapshotReviewHost,
): ReviewCanvasBridge {
  const request = async (url: string | URL): Promise<Response> => {
    const { pathname, searchParams } = new URL(String(url));
    const route = pathname.slice(pathname.indexOf("/reviews-api") + 12);
    const id = api.snapshot.reviewId;

    if (route === "/watch") {
      const line: ReviewStreamLine<Snapshot> = {
        kind: "review",
        reviewId: id,
        value: {
          ...api.snapshot,
          activity: { workingCount: 0, expiresAt: null },
          coverageRevision: 0,
        },
      };

      return new Response(
        new ReadableStream({
          start: (stream) =>
            stream.enqueue(
              new TextEncoder().encode(`${JSON.stringify(line)}\n`),
            ),
        }),
      );
    }

    if (route === `/${id}` && searchParams.get("full") === "true")
      return Response.json(api.snapshot);

    if (route === `/${id}/progress`)
      return Response.json(
        api.progress ??
          ({
            files: [],
            lenses: [],
            resolvedSelections: {},
          } satisfies ReviewProgress),
      );

    if (route === `/${id}/diff`)
      return Response.json(searchParams.has("file") ? "" : []);

    if (route === `/${id}/commits`) return Response.json(api.commits ?? []);

    // Its traces are the ones its quotes carry, not a stored session list.
    if (route === `/${id}/agent-traces`)
      return Response.json({ ok: true, sessions: [] });

    const map = /^\/[^/]+\/maps\/([^/]+)$/.exec(route);

    if (map && api.maps && Object.hasOwn(api.maps, map[1]!))
      return Response.json(api.maps[map[1]!]);

    const resource = /^\/([^/]+)\/resources\/([^/]+)$/.exec(route);

    if (
      resource &&
      resource[1] === id &&
      api.resources &&
      Object.hasOwn(api.resources, resource[2]!)
    ) {
      const value = api.resources[resource[2]!];

      return isBytes(value)
        ? new Response(new Blob([value.bytes]), {
            headers: { "content-type": value.type },
          })
        : Response.json(value);
    }

    return Response.json(
      { error: `Not in this snapshot: ${route}` },
      { status: 404 },
    );
  };

  return {
    config: host.config,
    inlineEditors: host.inlineEditors,
    diffView: host.diffView,
    request,
    post: async () => ({ ok: true }),
    subscribe: () => ({ dispose() {} }),
    currentTheme: () => host.theme ?? host.config.theme,
    onDidChangeTheme: () => ({ dispose() {} }),
    currentDiffLayout: () => "unified",
    async setDiffLayout() {},
    onDidChangeDiffLayout: () => ({ dispose() {} }),
    currentInlineLineNumbers: () => false,
    async setInlineLineNumbers() {},
    onDidChangeInlineLineNumbers: () => ({ dispose() {} }),
    ready() {},
  };
}
