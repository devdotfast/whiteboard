// @vitest-environment jsdom
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ReviewCanvasBridge } from "@dev.fast/review-protocol";
import { Hono } from "hono";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createReviewApi } from "../../src/review-api/http";
import { ReviewStore } from "../../src/review-api/store";
import { mountReviewCanvas as mount } from "./desktop-entry";
import { testReviewBridge } from "./review-session-test-utils";

let store: ReviewStore, directory: string;

let canvas: ReturnType<typeof mount> | undefined;

const command = <Operation,>(operation: Operation) =>
  store.execute({ commandId: randomUUID(), operation });

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
    pins: { repositoryId: "repo", base: "base", head: "head" },
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
      '[data-lens-id="api"] .diff-lens-toggle',
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

function tab(container: HTMLElement, label: string) {
  return container.querySelector<HTMLButtonElement>(
    `[aria-label="Session views"] button[aria-label="${label}"]`,
  );
}
