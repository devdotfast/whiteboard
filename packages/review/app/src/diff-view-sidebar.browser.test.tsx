import { ReviewApiClient } from "@review/review-api/client";
import type { Snapshot } from "@review/review-api/store";
import { act, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { TestCanvasQuery } from "./canvas-query-test-utils";
import { ReviewDiffView } from "./DiffView";
import { ReviewSessionProvider } from "./host/review-session";
import { ReviewLensesProvider } from "./review-lenses";
import { ReviewPanelProvider } from "./review-panel";
import { type ReviewRoots, ReviewRootsProvider } from "./review-root-context";
import { testReviewSession } from "./review-session-test-utils";

let app: HTMLDivElement | undefined;

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  app?.remove();
});

const snapshot: Snapshot = {
  reviewId: "diff-sidebar",
  version: 1,
  title: "Diff",
  pins: { repositoryId: "r", base: "b", head: "h" },
  target: { kind: "commits", repositoryId: "r", base: "b", head: "h" },
  document: [],
  lenses: [{ id: "api", title: "API", targets: [] }],
  createdAt: "2026-10-12",
};

/** The Diff view on a host with Desktop's sidebar, or on one without. */
const render = async (sidebar: boolean) => {
  const session = testReviewSession(
    {},
    {
      request: async () =>
        Response.json({ files: [], lenses: [], resolvedSelections: {} }),
      diffView: {
        files: async () => [],
        create: () => ({
          focus() {},
          onDidError: () => ({ dispose() {} }),
          dispose() {},
        }),
      },
      // Desktop answers for the board whether its sidebar is open or
      // folded to the rail; a host without one has no answer.
      ...(sidebar && {
        sidebarShowsBoard: () => true,
        onDidChangeSidebarShowsBoard: () => ({ dispose() {} }),
      }),
    },
  );

  const client = new ReviewApiClient(session.config, session.bridge.request);

  app = document.createElement("div");
  document.body.append(app);

  const roots: ReviewRoots = {
    appRef: { current: app },
    shellRef: createRef<HTMLElement>(),
    scrollRegionRef: createRef<HTMLElement>(),
    articleRef: createRef<HTMLElement>(),
  };

  root = createRoot(app);
  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={session}>
          <ReviewRootsProvider roots={roots}>
            <ReviewPanelProvider>
              <ReviewLensesProvider client={client} snapshot={snapshot}>
                <ReviewDiffView />
              </ReviewLensesProvider>
            </ReviewPanelProvider>
          </ReviewRootsProvider>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );
};

it("leaves the files and lenses to Desktop's sidebar, open or folded, and draws its own only without one", async () => {
  await render(true);
  await expect.poll(() => app!.querySelector(".diff-workspace")).not.toBeNull();
  expect(app!.querySelector(".diff-native-tree")).toBeNull();
  expect(app!.querySelector("[data-lens-id]")).toBeNull();

  await act(async () => root?.unmount());
  app!.remove();

  await render(false);
  await expect
    .poll(() => app!.querySelector(".diff-native-tree"))
    .not.toBeNull();
});
