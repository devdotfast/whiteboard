import type {
  ReviewCanvasUi,
  ReviewCommitSummary,
  ReviewDisposable,
} from "@dev.fast/review-protocol";
import { resourceReferences } from "@review/review-api/document";
import type { ReviewProgress } from "@review/review-api/review-progress";
import type { Snapshot } from "@review/review-api/store";
import * as stylex from "@stylexjs/stylex";
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  type BoardTrace,
  type SavedMap,
  createDocumentLoader,
  savedMapModel,
} from "./api-document";
import { createCanvasQueryClient } from "./canvas-query";
import { CanvasUiContext } from "./host/canvas-ui";
import { hostApiClient } from "./host/review-session";
import { ReviewContainerProvider } from "./review-root-context";
import { testReviewBridge } from "./review-session-test-utils";
import { ReviewTopBar } from "./review-top-bar";
import { shellStyles } from "./shell-styles";
import { themeStyles } from "./theme-styles";
import {
  Whiteboard,
  type WhiteboardData,
  type WhiteboardHost,
  WhiteboardProvider,
  type WhiteboardSettings,
} from "./whiteboard";

export interface FixtureBoard {
  snapshot: Snapshot;
  images?: Record<string, FixtureBytes>;
  traces?: Record<string, BoardTrace>;
  maps?: Record<string, SavedMap>;
  commits?: ReviewCommitSummary[];
  progress?: ReviewProgress;
}

// A lens or map routes its edges through libavoid; Vite serves the wasm from
// node_modules when a browser test names it by file URL.
export const libavoidWasmUrl = new URL(
  "../../../../node_modules/@mr_mint/elkjs-libavoid/dist/libavoid.wasm",
  import.meta.url,
).href;

export interface FixtureBytes {
  bytes: Uint8Array<ArrayBuffer>;
  type: string;
}

export function loadFixture(fixture: FixtureBoard): WhiteboardData {
  const { snapshot } = fixture;

  const data = createDocumentLoader(
    hostApiClient({}),
    createCanvasQueryClient(),
  ).draft(snapshot);

  for (const node of resourceReferences(snapshot.document)) {
    const image = node.type === "image" && fixture.images?.[node.assetId];
    const trace = node.type === "trace_quote" && fixture.traces?.[node.traceId];

    const saved =
      node.type === "software_map" && fixture.maps?.[node.mapVersionId];

    if (node.type === "image" && image)
      data.images.set(
        node.assetId,
        URL.createObjectURL(new Blob([image.bytes], { type: image.type })),
      );

    if (node.type === "trace_quote" && trace)
      data.traces.set(node.traceId, trace);

    if (node.type === "software_map" && saved) {
      const model = savedMapModel(saved);

      data.maps.set(node.mapVersionId, {
        ...model,
        pinnedData: { ...model.pinnedData, diagramId: node.id },
      });
    }
  }

  return {
    ...data,
    commits: fixture.commits ?? [],
    progress: fixture.progress,
  };
}

// No optional methods; a placeholder stands in for each inline editor.
export function fixtureHost(
  overrides: Partial<WhiteboardHost> = {},
): WhiteboardHost {
  return testReviewBridge(
    { wasmUrl: libavoidWasmUrl },
    {
      request: undefined,
      inlineEditors: {
        async find() {
          return { matchCount: 0 };
        },
        create: (spec) => {
          const editor = document.createElement("div");
          editor.className = "fixture-inline-editor";
          editor.dataset.path = spec.path;
          spec.container.appendChild(editor);

          return {
            height: 180,
            setActive() {},
            setCollapsed() {},
            async setFindQuery() {
              return { matchCount: 0 };
            },
            revealFindMatch() {},
            clearActiveFindMatch() {},
            clearFind() {},
            onDidChangeHeight: () => ({ dispose() {} }),
            onDidError: () => ({ dispose() {} }),
            dispose: () => {
              editor.remove();
            },
          };
        },
      },
      ...overrides,
    },
  );
}

export function mountWhiteboard(
  container: HTMLElement,
  data: WhiteboardData,
  options: {
    host?: WhiteboardHost;
    settings?: WhiteboardSettings;
    ui?: ReviewCanvasUi;
  } = {},
): ReviewDisposable {
  container.classList.add("review-canvas-root");
  const root = createRoot(container);

  root.render(
    <ReviewContainerProvider container={container}>
      <CanvasUiContext.Provider value={options.ui}>
        <div {...stylex.props(themeStyles.vars, shellStyles.apiCanvas)}>
          <WhiteboardProvider
            data={data}
            host={options.host ?? fixtureHost()}
            settings={options.settings ?? {}}
          >
            <ReviewTopBar />
            <Whiteboard />
          </WhiteboardProvider>
        </div>
      </CanvasUiContext.Provider>
    </ReviewContainerProvider>,
  );

  return { dispose: () => root.unmount() };
}

/**
 * Poll while flushing React: in the act environment, updates queued by the
 * canvas's effects only commit inside act, so a plain poll sees the first
 * paint.
 */
export async function settled<T>(read: () => T, timeout = 10_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let value = read();

  while (!value && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await act(async () => {});
    value = read();
  }

  return value;
}
