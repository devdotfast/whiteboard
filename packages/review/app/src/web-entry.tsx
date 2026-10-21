import { EmptyState } from "@canvas/ui/empty-state";
import { type JsonValue, isJsonObject } from "@dev.fast/review-protocol";
import { shareManifestSchema } from "@dev.fast/review-share-protocol";
import {
  parseSharedSnapshot,
  sharePresentationSchema,
} from "@review/sharing/content";
import { useMemo, useState } from "react";

import { ApiCanvas } from "./api-canvas";
import { ReviewContainerProvider } from "./review-root-context";
import {
  type SnapshotReviewApi,
  snapshotReviewBridge,
} from "./snapshot-review-bridge";
import { createSourceViewer } from "./source-viewer";
import { themeHostClassName } from "./theme-styles";
import type { SharedBoardBundle, WhiteboardComponent } from "./web-entry-api";

import "./styles.css";

export { verifySharedBoard } from "./share-verify";

export { createSourceViewer } from "./source-viewer";

export type {
  SharedBoardBundle,
  WhiteboardProps,
  SourceRequest,
  SourceViewerOptions,
  UnverifiedSharedBoard,
} from "./web-entry-api";

/** Reads a share into the saved version the canvas mounts. Throws when
 * any part of it does not parse. */
export function readSharedBoard(share: SharedBoardBundle): SnapshotReviewApi {
  // Parsed again: a page may render a share it never verified.
  const manifest = shareManifestSchema.parse(share.manifest);
  const { objects } = share;

  const bytes = (id: string) => {
    const object = objects.get(id);

    if (!object) throw new Error(`Shared object ${id} is missing.`);

    return object;
  };

  // SAFETY: shared JSON objects are parsed by their schemas below, or read
  // by the canvas's own resource parsers.
  const json = (id: string) =>
    JSON.parse(new TextDecoder().decode(bytes(id))) as JsonValue;

  const snapshot = parseSharedSnapshot(json(manifest.snapshot));
  const presentation = json(manifest.presentation);
  // Checked here; the canvas reads each map as sent.
  sharePresentationSchema.parse(presentation);

  return {
    // Every quote is settled: without the sender's checkout, none resolves.
    progress: {
      complete: true,
      files: [],
      lenses: [],
      resolvedSelections: {},
    },
    snapshot: {
      ...snapshot,
      // A share carries no diff to compare against its pins.
      pins: undefined,
      shared: { cloneUrl: manifest.repository?.cloneUrl },
    },
    maps:
      isJsonObject(presentation) && isJsonObject(presentation.maps)
        ? presentation.maps
        : {},
    resources: Object.fromEntries(
      manifest.resources.map((resource) => [
        resource.id,
        resource.kind === "image"
          ? { bytes: bytes(resource.object), type: resource.mimeType }
          : json(resource.object),
      ]),
    ),
  };
}

// The bridge answers every request, so this origin only names the URLs the
// canvas builds; nothing fetches it. A constant renders on a server too.
const SNAPSHOT_ORIGIN = "http://snapshot.invalid";

/** A shared board's content, read-only: its document and nothing around it. */
export const Whiteboard: WhiteboardComponent = ({
  share,
  wasmUrl,
  theme = "dark",
  inlineEditors,
}) => {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);

  // Someone else's content: a share that does not parse, or nests deeper than
  // the stack, shows as unreadable instead of throwing out of the page.
  const api = useMemo(() => {
    try {
      return readSharedBoard(share);
    } catch {
      return null;
    }
  }, [share]);

  const bridge = useMemo(
    () =>
      api &&
      snapshotReviewBridge(api, {
        config: {
          serverUrl: SNAPSHOT_ORIGIN,
          reviewId: api.snapshot.reviewId,
          token: "",
          wasmUrl,
          appVersion: "web",
          theme,
          host: "desktop",
        },
        theme,
        inlineEditors:
          inlineEditors ??
          createSourceViewer({
            readSource: () =>
              Promise.reject(new Error("This share has no source text.")),
          }),
        diffView: {
          files: async () => [],
          create: () => {
            throw new Error("A share has no diff.");
          },
        },
      }),
    [api, wasmUrl, theme, inlineEditors],
  );

  // The stylesheet is scoped to .review-canvas-root, where only :scope
  // matches the root itself: the theme class sits on a host inside it.
  return (
    <div ref={setRoot} className="review-canvas-root" data-review-theme={theme}>
      <div className={themeHostClassName(theme)}>
        {!api || !bridge ? (
          <EmptyState
            variant="boxed"
            role="alert"
            title="This board can't be shown"
            message="Its share could not be read."
          />
        ) : root ? (
          <ReviewContainerProvider container={root}>
            <ApiCanvas
              content={{
                kind: "api",
                reviewId: api.snapshot.reviewId,
                // No checkout to open files or the source tree from.
                available: {
                  sourceWindows: false,
                  reason: "A shared board has no source tree.",
                },
                bridge,
              }}
              contentOnly
            />
          </ReviewContainerProvider>
        ) : null}
      </div>
    </div>
  );
};
