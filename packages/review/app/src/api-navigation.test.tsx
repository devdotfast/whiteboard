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
  const pageBar = container.querySelector("header")!;

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
          container.querySelector("header [data-page-bar-crumb]"),
        ).not.toBeNull(),
      );
    });

    return container.querySelector("header [data-page-bar-crumb]")!;
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

it("draws a board's text before its commits, and its siblings and itself again before any read", async () => {
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

  const board = async (title: string, markdown = "") =>
    (
      await store.execute(
        {
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
        },
        { origin: {}, document: [{ type: "markdown", markdown }] },
      )
    ).reviewId;

  const parent = await board("Stack");
  const first = await board("First", "First board");
  const second = await board("Second", "Second board");

  for (const child of [first, second])
    await store.execute({
      operation: { type: "set_parent", reviewId: child, parentId: parent },
    });

  let letThrough!: () => void;
  const gate = new Promise<void>((resolve) => (letThrough = resolve));
  const requested: string[] = [];
  let held = false;
  const app = new Hono();
  app.get("/reviews-api/:id/commits", async (c) => {
    await gate;

    return c.json([]);
  });
  app.route("/reviews-api", createReviewApi(store));

  const bridge = testReviewBridge(
    {},
    {
      request: async (url, init) => {
        if (held) await new Promise(() => {});
        requested.push(String(url));

        return app.request(url, init);
      },
    },
  );

  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    canvas = mountReviewCanvas(container, {
      kind: "api",
      reviewId: first,
      bridge,
    });
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain("First board");
  });

  // Its commits are still being read; then its sibling is followed and read.
  letThrough();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(requested).toContainEqual(
      expect.stringContaining(`/${second}/commits`),
    );
  });

  // Nothing answers now: a sibling draws from what the canvas followed.
  held = true;
  act(() => canvas!.update({ kind: "api", reviewId: second, bridge }));

  expect(container.textContent).toContain("Second board");

  // Its own stream follows the board left behind, which draws at once too.
  held = false;
  await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
  act(() => canvas!.update({ kind: "api", reviewId: first, bridge }));

  expect(container.textContent).toContain("First board");
  expect(container.textContent).not.toContain("Second board");

  // A sibling edited while away draws its edit, never what it was.
  await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
  await store.execute({
    operation: {
      type: "edit",
      reviewId: second,
      edit: {
        type: "update",
        targetId: store.read(second).document[0]!.id,
        changes: { markdown: "Second, edited" },
      },
    },
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
  act(() => canvas!.update({ kind: "api", reviewId: second, bridge }));

  expect(container.textContent).toContain("Second, edited");
  expect(container.textContent).not.toContain("Second board");
});

it("draws a board in its stack before any read", async () => {
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

  const board = async (branch: string, markdown: string) =>
    (
      await store.execute(
        {
          operation: {
            type: "create",
            title: branch,
            target: {
              kind: "commits",
              repositoryId: "repo",
              base: "base",
              head: "head",
            },
          },
        },
        { origin: { branch }, document: [{ type: "markdown", markdown }] },
      )
    ).reviewId;

  const lower = await board("lower", "Lower board");
  const upper = await board("upper", "Upper board");

  const requested: string[] = [];
  let held = false;
  const app = new Hono();
  app.get("/reviews-api/:id/stack", (c) =>
    c.json({
      layers: [lower, upper].map((reviewUuid, index) => ({
        branch: index ? "upper" : "lower",
        pullRequestNumber: null,
        pullRequestUrl: null,
        base: null,
        subject: null,
        reviewUuid,
        reviewTitle: null,
        relation: reviewUuid === c.req.param("id") ? "current" : "earlier",
      })),
    }),
  );
  app.route("/reviews-api", createReviewApi(store));

  const bridge = testReviewBridge(
    {},
    {
      request: async (url, init) => {
        if (held) await new Promise(() => {});
        requested.push(String(url));

        return app.request(url, init);
      },
    },
  );

  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    canvas = mountReviewCanvas(container, {
      kind: "api",
      reviewId: lower,
      bridge,
    });
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(requested).toContainEqual(
      expect.stringContaining(`/${upper}/commits`),
    );
  });

  // Nothing answers now: a board in its stack draws from what was followed.
  held = true;
  act(() => canvas!.update({ kind: "api", reviewId: upper, bridge }));

  expect(container.textContent).toContain("Upper board");
});
