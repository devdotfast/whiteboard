import type { WhiteboardHost } from "@canvas/whiteboard";
import type {
  ReviewDiffLayout,
  ReviewDiffLayoutScope,
  ReviewDisposable,
  ReviewPeekViewer,
  ReviewSurfaceEvent,
  ReviewTheme,
} from "@dev.fast/review-protocol";

import {
  type BoardSources,
  type PeekSettings,
  type SourcePeeks,
  staticPeeks,
} from "./peeks";

/** Draws a host's peeks; one that quotes lines takes them by `setSources`. */
export type SharePeeks = (
  settings: PeekSettings,
) => ReviewPeekViewer & Partial<Pick<SourcePeeks, "setSources">>;

export interface ShareHost extends WhiteboardHost, ReviewDisposable {
  /** Hands the peeks the lines they quote. */
  setSources(code: BoardSources): Promise<void>;
}

// Shipped beside the package's index.js; Vite serves it from node_modules in
// tests and dev. Read on demand: a Worker may lack import.meta.url.
export const libavoidWasmUrl = () =>
  new URL(
    "../../../../../node_modules/@mr_mint/elkjs-libavoid/dist/libavoid.wasm",
    import.meta.url,
  ).href;

function listeners<T>() {
  const set = new Set<(value: T) => void>();

  return {
    add(listener: (value: T) => void): ReviewDisposable {
      set.add(listener);

      return { dispose: () => set.delete(listener) };
    },
    fire(value: T) {
      for (const listener of set) listener(value);
    },
    clear: () => set.clear(),
  };
}

/** A read-only host: no requests, no diff, and every verb a no-op. */
export function shareHost(options: {
  theme: ReviewTheme;
  wasmUrl: string;
  peeks: SharePeeks;
}): ShareHost {
  let lineNumbers = false;

  const layouts: Record<ReviewDiffLayoutScope, ReviewDiffLayout> = {
    diff: "split",
    peek: "unified",
  };

  const events = listeners<ReviewSurfaceEvent>();
  const lineNumberListeners = listeners<boolean>();

  const layoutListeners = {
    diff: listeners<ReviewDiffLayout>(),
    peek: listeners<ReviewDiffLayout>(),
  };

  const settings: PeekSettings = {
    currentDiffLayout: (scope) => layouts[scope],
    onDidChangeDiffLayout: (scope, listener) =>
      layoutListeners[scope].add(listener),
    currentInlineLineNumbers: () => lineNumbers,
    onDidChangeInlineLineNumbers: lineNumberListeners.add,
  };

  const peeks = options.peeks(settings);

  return {
    ...settings,
    wasmUrl: options.wasmUrl,
    appVersion: "share",
    peeks,
    async setSources(code) {
      await peeks.setSources?.(code);
    },
    diffView: {
      files: async () => [],
      create: () => ({
        focus() {},
        onDidError: () => ({ dispose() {} }),
        dispose() {},
      }),
    },
    post: async () => ({ ok: true }),
    subscribe: events.add,
    currentTheme: () => options.theme,
    onDidChangeTheme: () => ({ dispose() {} }),
    async setDiffLayout(scope, layout) {
      layouts[scope] = layout;
      layoutListeners[scope].fire(layout);
    },
    async setInlineLineNumbers(show) {
      lineNumbers = show;
      lineNumberListeners.fire(show);
    },
    ready() {},
    dispose() {
      for (const set of [
        events,
        lineNumberListeners,
        layoutListeners.diff,
        layoutListeners.peek,
      ])
        set.clear();
    },
  };
}

/** `shareHost` with openShare's defaults; `peeks` draws the source peeks. */
export function readOnlyHost(
  options: {
    theme?: ReviewTheme;
    wasmUrl?: string;
    peeks?: SharePeeks;
  } = {},
): ShareHost {
  return shareHost({
    ...options,
    theme: options.theme ?? "system",
    wasmUrl: options.wasmUrl ?? libavoidWasmUrl(),
    peeks: options.peeks ?? staticPeeks,
  });
}
