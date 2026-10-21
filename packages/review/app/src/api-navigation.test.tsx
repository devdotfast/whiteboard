import type { ReviewCanvasBridge } from "@dev.fast/review-protocol";
// @vitest-environment jsdom
import { createReviewApi } from "@review/review-api/http";
import { ReviewStore } from "@review/review-api/store";
import { Hono } from "hono";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { mountReviewCanvas } from "./desktop-entry";
import { testReviewBridge } from "./review-session-test-utils";

let canvas: ReturnType<typeof mountReviewCanvas> | undefined;

let store: ReviewStore;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  await act(async () => canvas?.dispose());
  await store?.close();
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it("exposes JSON section and Markdown headings plus imported PR and its place under its parent", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  store = new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });

  const { reviewId } = await store.execute(
    {
      operation: {
        type: "create",
        title: "Navigation",
        target: {
          kind: "commits",
          repositoryId: "repo",
          base: "base",
          head: "head",
        },
      },
    },
    {
      origin: {
        pullRequestNumber: 42,
        pullRequestUrl: "https://github.com/example/repo/pull/42",
      },
      document: [
        { type: "markdown", markdown: "## Summary\n\nText\n\n### **Details**" },
        {
          type: "section",
          title: "Implementation",
          children: [
            { type: "markdown", markdown: "## Details\n\nNested text" },
          ],
        },
      ],
    },
  );

  // Its parent, and the sibling it builds on.
  const board = async (title: string) =>
    (
      await store.execute({
        operation: {
          type: "create",
          title,
          target: {
            kind: "commits",
            repositoryId: "repo",
            base: "base",
            head: "head",
          },
        },
      })
    ).reviewId;

  const parent = await board("Stack");
  const earlier = await board("Earlier");

  for (const child of [earlier, reviewId])
    await store.execute({
      operation: { type: "set_parent", reviewId: child, parentId: parent },
    });
  await store.execute({
    operation: { type: "set_dependencies", reviewId, dependsOn: [earlier] },
  });

  const app = new Hono();
  app.get("/reviews-api/:id/stack", (c) => c.json({ layers: [] }));
  app.route("/reviews-api", createReviewApi(store));
  app.get("/reviews-api/:id/commits", (c) => c.json([]));
  const post = vi.fn<() => Promise<{ ok: true }>>(async () => ({ ok: true }));

  const reportSidebar =
    vi.fn<NonNullable<ReviewCanvasBridge["reportSidebar"]>>();

  const listeners = new Set<Parameters<ReviewCanvasBridge["subscribe"]>[0]>();

  const bridge = testReviewBridge(
    {},
    {
      request: async (url, init) => app.request(url, init),
      post,
      reportSidebar,
      subscribe: (listener) => {
        listeners.add(listener);

        return { dispose: () => void listeners.delete(listener) };
      },
      diffView: {
        files: async () => [],
        create: () => {
          throw new Error("Unused");
        },
      },
    },
  );

  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    canvas = mountReviewCanvas(container, { kind: "api", reviewId, bridge });
  });
  await act(async () => {
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Nested text"),
    );
  });
  expect(
    container.querySelector('a[href="https://github.com/example/repo/pull/42"]')
      ?.textContent,
  ).toContain("#42");
  const headings = [...container.querySelectorAll("article h2, article h3")];
  expect(headings.map((heading) => heading.textContent)).toEqual([
    "Summary",
    "Details",
    "Implementation",
    "Details",
  ]);
  // The slugs legacy MDX published, so imported `#fragment` links still land.
  expect(headings.map((heading) => heading.id)).toEqual([
    "summary",
    "details",
    "implementation",
    "details-2",
  ]);
  // Desktop's sidebar tabs pick the view, so the page bar holds only the
  // board's place and its actions.
  const pageBar = container.querySelector("main > header")!;

  expect(pageBar.querySelector('[aria-label="Session views"]')).toBeNull();
  // The text draws first; its place is read beside it.
  await act(async () => {
    await vi.waitFor(() =>
      expect(
        pageBar.querySelector('[aria-label$=", 2 of 2 in Stack"]'),
      ).not.toBeNull(),
    );
  });
  expect(pageBar.querySelector('[aria-label="More"]')).not.toBeNull();

  // Every board names its place in the page bar: a top board with its
  // children's menu, and a board on its own by its title alone.
  const crumbOf = async (id: string) => {
    await act(async () => canvas?.dispose());
    await act(async () => {
      canvas = mountReviewCanvas(container, {
        kind: "api",
        reviewId: id,
        bridge,
      });
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          container.querySelector("main > header [data-page-bar-crumb]"),
        ).not.toBeNull(),
      );
    });

    return container.querySelector("main > header [data-page-bar-crumb]")!;
  };

  const top = await crumbOf(parent);

  expect(top.textContent).toMatch(/^Stack2 boards/);
  expect(top.querySelector('[aria-label="2 boards in Stack"]')).not.toBeNull();

  const lone = await crumbOf(await board("Alone"));

  expect(lone.textContent).toMatch(/^Alone/);
  expect(lone.querySelector("[aria-haspopup=menu]")).toBeNull();
});

it("reports a board's view without waiting for its diff", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  store = new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });

  const { reviewId } = await store.execute(
    {
      operation: {
        type: "create",
        title: "Slow diff",
        target: {
          kind: "commits",
          repositoryId: "repo",
          base: "base",
          head: "head",
        },
      },
    },
    {
      origin: {},
      document: [
        { type: "markdown", markdown: "## Summary\n\nText\n\n## Details" },
      ],
    },
  );

  // The diff and its progress never answer.
  const never = () => new Promise<Response>(() => {});
  const app = new Hono();
  app.get("/reviews-api/:id/progress", never);
  app.get("/reviews-api/:id/structural-diff", never);
  app.get("/reviews-api/:id/diff", never);
  app.get("/reviews-api/:id/commits", (c) => c.json([]));
  app.route("/reviews-api", createReviewApi(store));

  const reportSidebar =
    vi.fn<NonNullable<ReviewCanvasBridge["reportSidebar"]>>();

  const bridge = testReviewBridge(
    {},
    {
      request: async (url, init) => app.request(url, init),
      reportSidebar,
      diffView: {
        files: () => new Promise(() => {}),
        create: () => {
          throw new Error("Unused");
        },
      },
    },
  );

  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    canvas = mountReviewCanvas(container, { kind: "api", reviewId, bridge });
  });
  await act(async () => {
    await vi.waitFor(() => expect(container.textContent).toContain("Text"));
  });

  await vi.waitFor(() =>
    expect(reportSidebar.mock.lastCall?.[0]).toMatchObject({
      view: "review",
      countsPending: true,
    }),
  );
  expect(reportSidebar.mock.lastCall![0].files).toBeUndefined();
});

it("draws a board's text before its commits", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  store = new ReviewStore(":memory:", {
    validatePins: async () => {},
    validateSource: async () => {},
    validateResource: async () => {},
  });

  const { reviewId } = await store.execute(
    {
      operation: {
        type: "create",
        title: "First",
        target: {
          kind: "commits",
          repositoryId: "repo",
          base: "base",
          head: "head",
        },
      },
    },
    { origin: {}, document: [{ type: "markdown", markdown: "First board" }] },
  );

  let letThrough!: () => void;
  const gate = new Promise<void>((resolve) => (letThrough = resolve));
  const app = new Hono();
  app.get("/reviews-api/:id/commits", async (c) => {
    await gate;

    return c.json([]);
  });
  app.route("/reviews-api", createReviewApi(store));

  const bridge = testReviewBridge(
    {},
    {
      request: async (url, init) => app.request(url, init),
    },
  );

  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    canvas = mountReviewCanvas(container, { kind: "api", reviewId, bridge });
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain("First board");
  });

  // Its commits are still being read.
  letThrough();
});
