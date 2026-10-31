import { mountWhiteboard, settled } from "@canvas/whiteboard-fixture";
import { selectionKey } from "@dev.fast/whiteboard-document";
import { act } from "react";
import { afterEach, expect, it } from "vitest";

import { type ShareView, openShare } from "./open-share";

const head = "a".repeat(40);

const base = "b".repeat(40);

const selection = (from: number, to: number) => ({
  [selectionKey({
    file: "order.ts",
    start: { side: "head", line: from },
    end: { side: "head", line: to },
  })]: [
    { side: "head" as const, file: "order.ts", fromLine: from, toLine: to },
  ],
});

let view: ShareView | undefined;

let canvas: ReturnType<typeof mountWhiteboard> | undefined;

afterEach(async () => {
  await act(async () => canvas?.dispose());
  view?.dispose();
  canvas = view = undefined;
});

it("renders a share's document and its excerpts read-only", async () => {
  view = await openShare(
    {
      format: "review-share/2",
      reviewId: "shared-board",
      version: 3,
      title: "Order status",
      repository: { cloneUrl: "https://github.com/octo/widgets.git" },
      snapshot: {
        reviewId: "shared-board",
        version: 3,
        title: "Order status",
        pins: { repositoryId: "repo", base, head },
        createdAt: "2026-10-22T00:00:00.000Z",
        document: [
          { id: "intro", type: "markdown", markdown: "Orders now queue." },
          { id: "shown", type: "code_peek", source: "head/order.ts#L1-L2" },
          { id: "missing", type: "code_peek", source: "head/order.ts#L9" },
        ],
      },
      images: {},
      traces: {},
      maps: {},
      commits: [],
      selections: { ...selection(1, 2), ...selection(9, 9) },
      sources: [
        {
          kind: "excerpt",
          file: "order.ts",
          commit: head,
          fromLine: 1,
          lines: ['export const status = "queued";', "// sent once written"],
        },
      ],
    },
    { theme: "light" },
  );
  expect(view.title).toBe("Order status");
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    canvas = mountWhiteboard(container, view!.data, { host: view!.host });
  });

  const peek = (id: string) =>
    container.querySelector(
      `[data-review-node-id="${id}"] [data-review-inline-editor]`,
    );

  expect(
    await settled(() => container.textContent?.includes("Orders now queue.")),
  ).toBe(true);
  expect(
    await settled(() => container.textContent?.includes("octo / widgets")),
  ).toBe(true);

  const keyword = await settled(() =>
    [...(peek("shown")?.querySelectorAll("span") ?? [])].find(
      (span) => span.textContent === "export" && span.className,
    ),
  );

  expect(keyword).toBeTruthy();
  expect(peek("shown")?.textContent).toContain("// sent once written");
  expect(peek("shown")?.querySelector("[data-unavailable]")).toBeNull();

  expect(
    await settled(() =>
      peek("missing")?.textContent?.includes("Code unavailable in this share"),
    ),
  ).toBe(true);

  // Neither Diff nor Trace: the share has no diff and no traces.
  expect(
    [...container.querySelectorAll("[aria-pressed]")].map((tab) =>
      tab.getAttribute("aria-label"),
    ),
  ).toEqual(["Whiteboard"]);
});
