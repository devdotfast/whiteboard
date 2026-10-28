import type { ReviewCanvasBridge } from "@dev.fast/review-protocol";
import type { Block } from "@dev.fast/whiteboard-document";
import type { ReactNode } from "react";

import type { ApiDocumentData } from "./api-document";
import { apiHeadingIds } from "./api-document-headings";
import { type ReviewClientConfig, reviewFetchUrl } from "./host/review-client";
import {
  type ReviewSession,
  ReviewSessionProvider,
  createReviewSession,
} from "./host/review-session";

export const TEST_REVIEW_CONFIG = {
  reviewId: "test-review",
} satisfies ReviewClientConfig;

type TestReviewConfig = ReviewClientConfig &
  Partial<Pick<ReviewCanvasBridge, "wasmUrl" | "appVersion">>;

export function testReviewBridge(
  config: TestReviewConfig = {},
  overrides: Partial<ReviewCanvasBridge> = {},
): ReviewCanvasBridge {
  return {
    wasmUrl: config.wasmUrl ?? "vscode-file://review/libavoid.wasm",
    appVersion: config.appVersion ?? "0.0.13",
    diffView: {
      files: async () => [],
      create: () => {
        throw new Error("unused test diff view");
      },
    },
    inlineEditors: {
      async find() {
        return { matchCount: 0 };
      },
      create: () => {
        throw new Error("unused test inline editor");
      },
    },
    request: (path, init) =>
      reviewFetchUrl({}, new URL(path, location.origin), init),
    post: async () => ({ ok: true }),
    subscribe: () => ({ dispose() {} }),
    currentTheme: () => "dark",
    onDidChangeTheme: () => ({ dispose() {} }),
    currentInlineLineNumbers: () => false,
    setInlineLineNumbers: async () => {},
    onDidChangeInlineLineNumbers: () => ({ dispose() {} }),
    currentDiffLayout: () => "split",
    async setDiffLayout() {},
    onDidChangeDiffLayout: () => ({ dispose() {} }),
    ready() {},
    ...overrides,
  };
}

export function testReviewSession(
  config: TestReviewConfig = {},
  bridge: Partial<ReviewCanvasBridge> = {},
): ReviewSession {
  return {
    ...createReviewSession(testReviewBridge(config, bridge), {
      jsonReview: {
        id: config.reviewId ?? TEST_REVIEW_CONFIG.reviewId,
        version: () => undefined,
      },
    }),
    review: {
      reviewId: config.reviewId ?? "test-review",
      pins: { base: "a".repeat(40), head: "b".repeat(40) },
      historicalRevision: null,
      updatedAtMs: Date.now(),
      traces: new Map(),
      place: async () => ({ siblings: [] }),
      stack: async () => ({ layers: [] }),
      createBranchReview: async () => "",
      dismiss: async () => true,
    },
  };
}

/** Document data for `blocks` alone, with empty resource maps. */
export function testApiDocumentData(blocks: Block[]): ApiDocumentData {
  return {
    snapshot: {
      reviewId: "11111111-1111-4111-8111-111111111111",
      version: 1,
      title: "Imported",
      pins: { repositoryId: "repo", base: "base", head: "head" },
      target: {
        kind: "commits",
        repositoryId: "repo",
        base: "base",
        head: "head",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      document: blocks,
    },
    headings: apiHeadingIds(blocks),
    commits: [],
    anchors: new Map(),
    images: new Map(),
    traces: new Map(),
    boards: new Map(),
    maps: new Map(),
  };
}

// Test files that are plain .ts cannot write JSX, and passing `children`
// through createElement's props trips react/no-children-prop.
export function reviewSessionElement(
  session: ReviewSession,
  children: ReactNode,
) {
  return (
    <ReviewSessionProvider session={session}>{children}</ReviewSessionProvider>
  );
}
