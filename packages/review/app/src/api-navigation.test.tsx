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
  expect(
    pageBar.querySelector('[aria-label$=", 2 of 2 in Stack"]'),
  ).not.toBeNull();
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

it("keeps the board and its page bar on screen until the next board has loaded", async () => {
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

  const requested: string[] = [];
  // The second board answers once let through.
  let letThrough!: () => void;
  const gate = new Promise<void>((resolve) => (letThrough = resolve));
  const app = new Hono();
  app.get("/reviews-api/:id/commits", (c) => c.json([]));
  app.route("/reviews-api", createReviewApi(store));

  const bridge = testReviewBridge(
    {},
    {
      request: async (url, init) => {
        if (String(url).includes(second)) await gate;
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
  await act(async () => {
    await vi.waitFor(() =>
      expect(
        container.querySelector(
          '[aria-label^="First, "][aria-label$=" of 2 in Stack"]',
        ),
      ).not.toBeNull(),
    );
  });

  await act(async () => {
    canvas!.update({ kind: "api", reviewId: second, bridge });
  });

  // The switcher already names the next board over the last one.
  const shown = [...container.querySelectorAll("main")].find(
    (main) => !main.closest("[inert]"),
  )!;

  expect(shown.textContent).toContain("First board");
  expect(
    shown.querySelector(
      '[aria-label^="Second, "][aria-label$=" of 2 in Stack"]',
    ),
  ).not.toBeNull();

  letThrough();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).not.toContain("First board");
  });
  expect(container.querySelector("[inert]")).toBeNull();
  expect(container.textContent).toContain("Second board");
  expect(
    container.querySelector(
      '[aria-label^="Second, "][aria-label$=" of 2 in Stack"]',
    ),
  ).not.toBeNull();

  // Back on the first board, its page bar comes from what the canvas read.
  await act(async () => {
    canvas!.update({ kind: "api", reviewId: first, bridge });
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain("First board");
    expect(container.querySelector("[inert]")).toBeNull();
  });
  expect(
    requested.filter((url) => url.endsWith(`/${first}/place`)),
  ).toHaveLength(1);
});
