import type {
  ReviewCanvasUi,
  ReviewDisposable,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { CanvasUiContext } from "./host/canvas-ui";
import { ReviewContainerProvider } from "./review-root-context";
import { testReviewBridge } from "./review-session-test-utils";
import { ReviewTopBar } from "./review-top-bar";
import { boardData } from "./share/board-data";
import { libavoidWasmUrl } from "./share/share-host";
import { shellStyles } from "./shell-styles";
import { themeStyles } from "./theme-styles";
import {
  Whiteboard,
  type WhiteboardData,
  type WhiteboardHost,
  WhiteboardProvider,
  type WhiteboardSettings,
} from "./whiteboard";

export { boardData as loadFixture };

// No optional methods; a placeholder stands in for each inline editor.
export function fixtureHost(
  overrides: Partial<WhiteboardHost> = {},
): WhiteboardHost {
  return testReviewBridge(
    { wasmUrl: libavoidWasmUrl() },
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
