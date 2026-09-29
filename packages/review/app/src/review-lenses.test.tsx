import { ReviewApiClient } from "@review/review-api/client";
import type { Snapshot } from "@review/review-api/store";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { createCanvasQueryClient } from "./canvas-query";
import { TestCanvasQuery } from "./canvas-query-test-utils";
import { ReviewDiffView } from "./DiffView";
import { ReviewSessionProvider } from "./host/review-session";
import { ReviewLensesProvider, useReviewLenses } from "./review-lenses";
import { ReviewPanelProvider } from "./review-panel";
import { testReviewSession } from "./review-session-test-utils";

it("clears a lens without destroying the full comparison's native state", async () => {
  const disposed: string[] = [];

  const session = testReviewSession(
    {},
    {
      request: async () =>
        Response.json({
          files: [],
          lenses: [
            {
              id: "diagram",
              title: "Path",
              sources: [{ side: "head", file: "a.ts", fromLine: 1, toLine: 8 }],
            },
          ],
        }),
      diffView: {
        files: async () => [],
        create(spec) {
          const id = spec.lens?.id ?? "full";
          spec.container.textContent = `native ${id}`;

          return {
            focus() {},
            onDidError: () => ({ dispose() {} }),
            dispose() {
              disposed.push(id);
            },
          };
        },
      },
    },
  );

  const client = new ReviewApiClient(session.config, session.bridge.request);

  const snapshot: Snapshot = {
    reviewId: "test-session",
    version: 0,
    title: "Test",
    target: {
      kind: "commits" as const,
      ...{ repositoryId: "r", base: "b", head: "h" },
    },
    pins: { repositoryId: "r", base: "b", head: "h" },
    document: [],
    createdAt: "2026-09-17",
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <ReviewPanelProvider>
              <ReviewLensesProvider client={client} snapshot={snapshot}>
                <ReviewDiffView />
              </ReviewLensesProvider>
            </ReviewPanelProvider>
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      ),
    );

    const full = container.querySelector<HTMLElement>(
      ".review-diff-view-host",
    )!;

    const button = await vi.waitFor(() => {
      const found = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Path"),
      );

      expect(found).toBeDefined();

      return found!;
    });

    await act(async () => button.click());
    expect(full.style.display).toBe("none");

    const selectedToggle = container.querySelector(".diff-lens-toggle");
    expect(selectedToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".review-diff-view-host")).toHaveLength(
      2,
    );
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-pressed="true"]')!
        .click();
    });
    expect(container.querySelector(".review-diff-view-host")).toBe(full);
    expect(full.style.display).toBe("");
    expect(disposed).toEqual(["diagram"]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

interface Pending {
  url: URL;
  method: string;
  signal?: AbortSignal | null;
  resolve(response: Response): void;
}

/** A progress endpoint whose every reply the test releases by hand. */
function progressHarness() {
  const requests: Pending[] = [];

  const client = new ReviewApiClient(
    { serverUrl: "http://localhost", token: "local" },
    (url, init) =>
      new Promise<Response>((resolve) =>
        requests.push({
          url: new URL(url),
          method: init?.method ?? "GET",
          signal: init?.signal,
          resolve,
        }),
      ),
  );

  const queryClient = createCanvasQueryClient();
  const session = testReviewSession();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let lenses: ReturnType<typeof useReviewLenses> = null;

  function Probe() {
    lenses = useReviewLenses();
    const label = (lenses?.progress as { label?: string } | null)?.label;

    return (
      <span>
        {`${label ?? "none"}|busy=${lenses?.busy}|error=${lenses?.error}|changed=${lenses?.changedPaths.join(",")}`}
      </span>
    );
  }

  const render = (version: number, coverageRevision = 0) =>
    act(async () =>
      root.render(
        <TestCanvasQuery client={queryClient}>
          <ReviewSessionProvider session={session}>
            <ReviewPanelProvider>
              <ReviewLensesProvider
                client={client}
                snapshot={{ ...lensSnapshot, version }}
                coverageRevision={coverageRevision}
              >
                <Probe />
              </ReviewLensesProvider>
            </ReviewPanelProvider>
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      ),
    );

  const progress = (label: string) =>
    Response.json({
      label,
      files: [
        {
          path: `${label}.ts`,
          fingerprint: label,
          changed: { base: [], head: [[0, 2]] },
          viewed: { base: [], head: [] },
        },
      ],
      lenses: [],
      resolvedSelections: {},
      complete: true,
    });

  const reads = () => requests.filter((request) => request.method === "GET");
  const marks = () => requests.filter((request) => request.method === "POST");

  const reply = (request: Pending | undefined, response: Response) =>
    act(async () => {
      request!.resolve(response);
      await settle();
    });

  return {
    container,
    queryClient,
    render,
    progress,
    reads,
    marks,
    reply,
    mark: (viewed = true) => lenses!.mark(undefined, viewed),
    text: () => container.textContent,
    dispose: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

const lensSnapshot: Snapshot = {
  reviewId: "test-session",
  version: 1,
  title: "Test",
  target: { kind: "commits", repositoryId: "r", base: "b", head: "h" },
  pins: { repositoryId: "r", base: "b", head: "h" },
  document: [],
  createdAt: "2026-09-17",
};

it("lands a mark over a read that started before it, then reads again", async () => {
  const harness = progressHarness();

  try {
    await harness.render(1);
    await harness.reply(harness.reads()[0], harness.progress("initial"));
    expect(harness.text()).toContain("initial|");

    await harness.render(1, 1);
    const overtaken = harness.reads()[1];
    expect(overtaken).toBeDefined();

    let marked!: Promise<void>;
    await act(async () => {
      marked = harness.mark();
      await settle();
    });
    expect(overtaken!.signal?.aborted).toBe(true);
    expect(harness.text()).toContain("busy=true");

    await harness.reply(harness.marks()[0], harness.progress("marked"));
    await act(() => marked);
    expect(harness.text()).toContain("marked|busy=false");
    expect(harness.text()).toContain("changed=initial.ts");

    // The read the mark overtook is repeated, and its late reply is ignored.
    const repeated = harness.reads()[2];
    expect(repeated?.url.searchParams.get("version")).toBe("1");
    await harness.reply(overtaken, harness.progress("stale"));
    expect(harness.text()).toContain("marked|");
    await harness.reply(repeated, harness.progress("fresh"));
    expect(harness.text()).toContain("fresh|");
  } finally {
    await harness.dispose();
  }
});

it("keeps a mark on an earlier version out of the version now shown", async () => {
  const harness = progressHarness();

  try {
    await harness.render(1);
    await harness.reply(harness.reads()[0], harness.progress("one"));

    let marked!: Promise<void>;
    await act(async () => {
      marked = harness.mark();
      await settle();
    });
    expect(harness.text()).toContain("busy=true");

    await harness.render(2);
    expect(harness.text()).toBe("none|busy=false|error=null|changed=");
    await harness.reply(harness.reads()[1], harness.progress("two"));

    await harness.reply(
      harness.marks()[0],
      Response.json({ error: "Review changed." }, { status: 409 }),
    );
    await act(() => marked);
    expect(harness.text()).toBe("two|busy=false|error=null|changed=");

    // The earlier version reads afresh rather than showing the late mark.
    await harness.render(1);
    expect(harness.text()).toContain("none|");
    expect(harness.reads()).toHaveLength(3);
  } finally {
    await harness.dispose();
  }
});

it("runs one mark at a time and reports a failed one", async () => {
  const harness = progressHarness();

  try {
    await harness.render(1);
    await harness.reply(harness.reads()[0], harness.progress("one"));

    let marked!: Promise<void>;
    await act(async () => {
      marked = harness.mark();
      void harness.mark(false);
    });
    expect(harness.marks()).toHaveLength(1);

    await harness.reply(
      harness.marks()[0],
      Response.json(
        { error: "This file changed. Reload before marking it viewed." },
        { status: 409 },
      ),
    );
    await act(() => marked);
    expect(harness.text()).toContain("one|busy=false");
    expect(harness.text()).toContain("This file changed.");

    await act(async () => {
      void harness.mark();
    });
    expect(harness.marks()).toHaveLength(2);
  } finally {
    await harness.dispose();
  }
});

it("defers live coverage during a mark and keeps one entry per version", async () => {
  const harness = progressHarness();

  try {
    await harness.render(1);
    await harness.reply(harness.reads()[0], harness.progress("one"));

    let marked!: Promise<void>;
    await act(async () => {
      marked = harness.mark();
      await settle();
    });
    await harness.render(1, 1);
    await harness.render(1, 2);
    expect(harness.reads()).toHaveLength(1);

    await harness.reply(harness.marks()[0], harness.progress("marked"));
    await act(() => marked);
    expect(harness.reads()).toHaveLength(2);
    await harness.reply(harness.reads()[1], harness.progress("covered"));

    for (const revision of [3, 4, 5]) {
      await harness.render(1, revision);
      await harness.reply(harness.reads().at(-1), harness.progress("live"));
    }

    expect(harness.reads()).toHaveLength(5);
    expect(harness.text()).toContain("live|");
    expect(harness.queryClient.getQueryCache().getAll()).toHaveLength(1);
  } finally {
    await harness.dispose();
  }
});
