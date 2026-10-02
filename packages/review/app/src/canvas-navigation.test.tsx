// @vitest-environment jsdom
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ReviewCanvasBridge } from "@dev.fast/review-protocol";
import { createReviewApi } from "@review/review-api/http";
import { ReviewStore } from "@review/review-api/store";
import { Hono } from "hono";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mountReviewCanvas as mount } from "./desktop-entry";
import { testReviewBridge } from "./review-session-test-utils";
import { writeReviewUiState } from "./review-ui-state";
import {
  readPersistedReviewViewState,
  reviewViewStateKey,
} from "./review-view-state";

// jsdom has no Element.scrollTo, and a diagram tour scrolls its active stop
// into view on the next frame.
HTMLElement.prototype.scrollTo = () => {};

let store: ReviewStore, directory: string;

let canvas: ReturnType<typeof mount> | undefined;

const command = <Operation,>(operation: Operation) =>
  store.execute({ operation });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  directory = mkdtempSync(path.join(tmpdir(), "review-canvas-navigation-"));
  store = new ReviewStore(path.join(directory, "review.db"), {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(async () => {
  await act(async () => canvas?.dispose());
  canvas = undefined;
  await store.close();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

it("resumes the view and lens a reader left, on the version they left them", async () => {
  const review = await command({
    type: "create",
    title: "Lens review",
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
  });

  const app = new Hono();
  app.get("/reviews-api/:id/progress", (context) =>
    context.json({
      files: [],
      lenses: [
        {
          id: "api",
          title: "API",
          sources: [{ file: "a.ts", side: "head", fromLine: 1, toLine: 2 }],
          fileCount: 1,
        },
      ],
      resolvedSelections: {},
    }),
  );
  app.route("/reviews-api", createReviewApi(store));
  app.get("/reviews-api/:id/commits", (context) => context.json([]));

  const listeners = new Set<Parameters<ReviewCanvasBridge["subscribe"]>[0]>();
  const diffLenses: (string | undefined)[] = [];

  const bridge = testReviewBridge(
    {},
    {
      request: async (url, init) => app.request(url, init),
      subscribe: (listener) => {
        listeners.add(listener);

        return { dispose: () => void listeners.delete(listener) };
      },
      diffView: {
        files: async () => [],
        create(spec) {
          diffLenses.push(spec.lens?.id);

          return {
            focus() {},
            onDidError: () => ({ dispose() {} }),
            dispose() {},
          };
        },
      },
    },
  );

  const container = document.createElement("div");
  document.body.append(container);

  const open = async () => {
    await act(async () => canvas?.dispose());
    diffLenses.length = 0;
    await act(async () => {
      canvas = mount(container, {
        kind: "api",
        reviewId: review.reviewId,
        bridge,
      });
    });
    await act(async () => {
      await vi.waitFor(() => expect(tab(container, "Diff")).toBeTruthy());
    });
  };

  const lensToggle = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-lens-id="api"] button[aria-pressed]',
    );

  await open();
  await act(async () => {
    for (const listener of listeners)
      listener({ event: "showReviewView", view: "commits" });
  });
  expect(tab(container, "Commits")?.getAttribute("aria-pressed")).toBe("true");

  // A host-opened view survives a reload.
  await open();
  expect(tab(container, "Commits")?.getAttribute("aria-pressed")).toBe("true");

  await act(async () => tab(container, "Diff")!.click());
  await act(async () => {
    await vi.waitFor(() => expect(lensToggle()?.disabled).toBe(false));
  });
  await act(async () => lensToggle()!.click());
  expect(diffLenses.at(-1)).toBe("api");

  // The reader comes back to the Diff with the same lens applied.
  await open();
  expect(tab(container, "Diff")?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => {
    await vi.waitFor(() =>
      expect(lensToggle()?.getAttribute("aria-pressed")).toBe("true"),
    );
  });
  expect(diffLenses.at(-1)).toBe("api");

  // A lens chosen on an earlier version does not carry over to a newer one.
  await command({
    type: "edit",
    reviewId: review.reviewId,
    edit: {
      type: "insert",
      content: { type: "markdown", markdown: "A later version" },
    },
  });
  await open();
  expect(tab(container, "Diff")?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => {
    await vi.waitFor(() => expect(lensToggle()).toBeTruthy());
  });
  expect(lensToggle()?.getAttribute("aria-pressed")).toBe("false");
  expect(diffLenses).not.toContain("api");
});

it("reopens a stored fullscreen tour only while its diagram is in the document", async () => {
  const review = await command({
    type: "create",
    title: "Tour review",
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
  });

  await command({
    type: "edit",
    reviewId: review.reviewId,
    edit: {
      type: "insert",
      content: {
        type: "sequence",
        title: "Startup",
        actors: { app: "App", db: "Database" },
        steps: [
          {
            from: "app",
            to: "db",
            label: "Load",
            explanation: "Reads config.",
          },
        ],
      },
    },
  });

  const [sequence] = store
    .read(review.reviewId)
    .document.flatMap((block) => (block.type === "sequence" ? [block] : []));

  const step = sequence!.steps[0]!.id!;

  const app = new Hono();
  app.route("/reviews-api", createReviewApi(store));
  app.get("/reviews-api/:id/commits", (context) => context.json([]));

  const bridge = testReviewBridge(
    {},
    { request: async (url, init) => app.request(url, init) },
  );

  const container = document.createElement("div");
  document.body.append(container);
  const key = reviewViewStateKey(bridge.config);

  const open = async (overlayTour: {
    tourId: string;
    activeAnchor: string;
  }) => {
    await act(async () => canvas?.dispose());
    writeReviewUiState("session", key, {
      overlayTour: { ...overlayTour, kind: "sequence" },
    });
    await act(async () => {
      canvas = mount(container, {
        kind: "api",
        reviewId: review.reviewId,
        bridge,
      });
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          container.querySelector(".review-document .sequence-diagram"),
        ).toBeTruthy(),
      );
    });
  };

  await open({ tourId: sequence!.id!, activeAnchor: step });
  expect(container.querySelector(".diagram-tour-overlay")).toBeTruthy();
  expect(readPersistedReviewViewState(bridge.config)).toMatchObject({
    overlayTour: { tourId: sequence!.id, activeAnchor: step },
  });

  // The diagram that owned this tour is gone: nothing reopens or keeps it.
  await open({ tourId: "removed", activeAnchor: step });
  expect(container.querySelector(".diagram-tour-overlay")).toBeNull();
  expect(readPersistedReviewViewState(bridge.config)).not.toHaveProperty(
    "overlayTour",
  );
});

it("keeps a flow diagram's tour in the canvas navigation", async () => {
  const review = await command({
    type: "create",
    title: "Flow review",
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
  });

  await command({
    type: "edit",
    reviewId: review.reviewId,
    edit: {
      type: "insert",
      content: {
        type: "flow_diagram",
        title: "Queue an order",
        nodes: [{ key: "start", label: "Start" }],
        edges: [],
      },
    },
  });

  const app = new Hono();
  app.route("/reviews-api", createReviewApi(store));
  app.get("/reviews-api/:id/commits", (context) => context.json([]));

  const bridge = testReviewBridge(
    {},
    { request: async (url, init) => app.request(url, init) },
  );

  const container = document.createElement("div");
  document.body.append(container);

  const open = async () => {
    await act(async () => canvas?.dispose());
    await act(async () => {
      canvas = mount(container, {
        kind: "api",
        reviewId: review.reviewId,
        bridge,
      });
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          container.querySelector(".review-document .flow-diagram"),
        ).toBeTruthy(),
      );
    });
  };

  const overlay = () => container.querySelector(".diagram-tour-overlay");

  await open();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Expand diagram"]')!
      .click(),
  );
  expect(overlay()).toBeTruthy();
  expect(readPersistedReviewViewState(bridge.config)).toMatchObject({
    overlayTour: { kind: "flow" },
  });

  await open();
  expect(overlay()).toBeTruthy();
  await act(async () => tab(container, "Commits")!.click());
  expect(overlay()).toBeNull();
});

it("resumes a commit diff with its scope", async () => {
  const review = await command({
    type: "create",
    title: "Commit review",
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
  });

  const commit = {
    commit: "a".repeat(40),
    parentCommit: "b".repeat(40),
    subject: "Add the API",
    author: "Developer",
    authoredAt: "2026-09-28T10:00:00Z",
    fileCount: 1,
    additions: 1,
    deletions: 0,
  };

  // Only the first version lists the commit.
  const scopedVersion = store.read(review.reviewId).version;
  const app = new Hono();
  app.get("/reviews-api/:id/commits", (context) =>
    context.json(
      Number(context.req.query("version")) === scopedVersion ? [commit] : [],
    ),
  );
  app.route("/reviews-api", createReviewApi(store));

  const { container, open } = canvasHarness(app, review.reviewId);

  const scopeBar = () =>
    container.querySelector(".review-diff-view--scoped > div:first-child");

  await open();
  await act(async () => tab(container, "Commits")!.click());
  await act(async () => {
    await vi.waitFor(() =>
      expect(
        container.querySelector('button[aria-label="Open commit diff"]'),
      ).toBeTruthy(),
    );
  });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Open commit diff"]',
      )!
      .click(),
  );
  expect(scopeBar()?.textContent).toContain("Add the API");

  await open();
  expect(tab(container, "Diff")?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => {
    await vi.waitFor(() =>
      expect(scopeBar()?.textContent).toContain("Add the API"),
    );
  });

  // A version that no longer lists the commit resumes the whole diff.
  await command({
    type: "edit",
    reviewId: review.reviewId,
    edit: {
      type: "insert",
      content: { type: "markdown", markdown: "A later version" },
    },
  });
  await open();
  expect(tab(container, "Diff")?.getAttribute("aria-pressed")).toBe("true");
  expect(scopeBar()).toBeNull();

  // The reader moved on to the whole diff, so the earlier version opens it too.
  await act(async () => tab(container, "Whiteboard")!.click());
  await act(async () => tab(container, "Diff")!.click());
  await open(scopedVersion);
  expect(tab(container, "Diff")?.getAttribute("aria-pressed")).toBe("true");
  expect(scopeBar()).toBeNull();
});

it("resumes the Trace view and the picked trace", async () => {
  const { reviewId } = await traceReview();

  const { container, open, show } = traceCanvas(reviewId, [
    traceSession,
    {
      ...traceSession,
      sessionId: "session-2",
      commits: [{ sha: "commit-2", subject: "Second session" }],
    },
  ]);

  const trigger = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="listbox"]',
    );

  const option = (title: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (item) => item.textContent?.includes(title),
    );

  await open();
  await act(async () => {
    await vi.waitFor(() => expect(tab(container, "Trace")).toBeTruthy());
  });
  await show("trace");
  await act(async () => {
    await vi.waitFor(() => expect(trigger()).toBeTruthy());
  });
  await act(async () => trigger()!.click());
  await act(async () => option("Second session")!.click());

  await open();
  await act(async () => {
    await vi.waitFor(() => expect(trigger()).toBeTruthy());
  });
  expect(tab(container, "Trace")?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => trigger()!.click());
  expect(option("Second session")?.getAttribute("aria-selected")).toBe("true");
  expect(option("Initial commit subject")?.getAttribute("aria-selected")).toBe(
    "false",
  );
});

it("lands a stored Trace view on the whiteboard once no traces are listed", async () => {
  const { reviewId } = await traceReview();
  const { container, open, show } = traceCanvas(reviewId, [traceSession]);

  await open();
  await act(async () => {
    await vi.waitFor(() => expect(tab(container, "Trace")).toBeTruthy());
  });
  await show("trace");
  expect(tab(container, "Trace")?.getAttribute("aria-pressed")).toBe("true");

  const empty = traceCanvas(reviewId, []);
  await empty.open();
  await act(async () => {
    await vi.waitFor(() =>
      expect(
        tab(empty.container, "Whiteboard")?.getAttribute("aria-pressed"),
      ).toBe("true"),
    );
  });
  expect(tab(empty.container, "Trace")).toBeNull();
});

const traceSession = {
  sessionId: "session-1",
  harness: "unknown",
  available: true,
  source: "r2",
  commits: [{ sha: "commit-1", subject: "Initial commit subject" }],
};

const traceReview = () =>
  command({
    type: "create",
    title: "Trace review",
    target: {
      kind: "commits",
      repositoryId: "repo",
      base: "base",
      head: "head",
    },
  });

function traceCanvas(reviewId: string, sessions: (typeof traceSession)[]) {
  const app = new Hono();
  app.get("/reviews-api/:id/agent-traces", (context) =>
    context.json({ ok: true, configured: true, sessions }),
  );
  app.get("/reviews-api/:id/commits", (context) => context.json([]));
  app.route("/reviews-api", createReviewApi(store));

  return canvasHarness(app, reviewId);
}

function canvasHarness(app: Hono, reviewId: string) {
  const listeners = new Set<Parameters<ReviewCanvasBridge["subscribe"]>[0]>();

  const bridge = testReviewBridge(
    {},
    {
      request: async (url, init) => app.request(url, init),
      subscribe: (listener) => {
        listeners.add(listener);

        return { dispose: () => void listeners.delete(listener) };
      },
      diffView: {
        files: async () => [],
        create: () => ({
          focus() {},
          onDidError: () => ({ dispose() {} }),
          dispose() {},
        }),
      },
    },
  );

  document.body.querySelector("[data-canvas-harness]")?.remove();
  const container = document.createElement("div");
  container.dataset.canvasHarness = "";
  document.body.append(container);

  const open = async (version?: number) => {
    await act(async () => canvas?.dispose());
    await act(async () => {
      canvas = mount(container, { kind: "api", reviewId, version, bridge });
    });
    await act(async () => {
      await vi.waitFor(() => expect(tab(container, "Diff")).toBeTruthy());
    });
  };

  const show = async (
    view: Extract<
      Parameters<Parameters<ReviewCanvasBridge["subscribe"]>[0]>[0],
      { event: "showReviewView" }
    >["view"],
  ) =>
    act(async () => {
      for (const listener of listeners)
        listener({ event: "showReviewView", view });
    });

  return { container, open, show };
}

function tab(container: HTMLElement, label: string) {
  return container.querySelector<HTMLButtonElement>(
    `[aria-label="Session views"] button[aria-label="${label}"]`,
  );
}
