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

  // Desktop's sidebar lists them in Contents, and scrolls the canvas to one.
  const { contents } = reportSidebar.mock.lastCall![0];

  expect(contents.map((entry) => entry.text)).toEqual(
    headings.map((heading) => heading.textContent),
  );
  const scroll = vi.fn<() => void>();
  container.querySelectorAll<HTMLElement>("*").forEach((element) => {
    element.scrollTo = scroll;
    element.scrollIntoView = scroll;
  });

  for (const { id } of contents)
    await act(async () => {
      for (const listener of listeners)
        listener({ event: "revealHeading", reviewId, headingId: id });
    });
  expect(scroll).toHaveBeenCalledTimes(4);
  expect(
    container.querySelector('[aria-label="2 of 2 in Stack"]'),
  ).not.toBeNull();
});

it("reports a board's Contents without waiting for its diff", async () => {
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
    expect(
      reportSidebar.mock.lastCall?.[0].contents.map((entry) => entry.text),
    ).toEqual(["Summary", "Details"]),
  );
  expect(reportSidebar.mock.lastCall![0]).toMatchObject({
    countsPending: true,
  });
  expect(reportSidebar.mock.lastCall![0].files).toBeUndefined();
});
