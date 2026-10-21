import type { ReviewCanvasBridge } from "@dev.fast/review-protocol";
import { act } from "react";

import { TEST_REVIEW_CONFIG } from "./review-session-test-utils";
import {
  type SnapshotReviewApi,
  snapshotReviewBridge,
} from "./snapshot-review-bridge";

// A lens or map routes its edges through libavoid; Vite serves the wasm from
// node_modules when a browser test names it by file URL.
export const libavoidWasmUrl = new URL(
  "../../../../node_modules/@mr_mint/elkjs-libavoid/dist/libavoid.wasm",
  import.meta.url,
).href;

/** Mounts the JSON canvas from fixtures, without a store. */
export function fixtureReviewBridge(
  api: SnapshotReviewApi,
): ReviewCanvasBridge {
  return snapshotReviewBridge(api, {
    config: { ...TEST_REVIEW_CONFIG, wasmUrl: libavoidWasmUrl },
    // A code peek asks the host for an inline editor; a placeholder proves it did.
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
    diffView: {
      files: async () => api.files ?? [],
      create: () => {
        throw new Error("Diff is not mounted by this test.");
      },
    },
  });
}

/**
 * Poll while flushing React: in the act environment, updates queued by the
 * canvas's fetches only commit inside act, so a plain poll sees the first paint.
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
