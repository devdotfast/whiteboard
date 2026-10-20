import type { ReviewCanvasBridge } from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { BoardLink } from "./board-link";
import { TestCanvasQuery } from "./canvas-query-test-utils";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

it("reads a link's hover card when it opens, once", async () => {
  const request = vi.fn<ReviewCanvasBridge["request"]>(
    async () =>
      new Response(JSON.stringify({ prose: ["Opening words."] }), {
        headers: { "content-type": "application/json" },
      }),
  );

  const session = testReviewSession({}, { request });
  const container = document.createElement("div");

  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <TestCanvasQuery>
        <ReviewSessionProvider session={session}>
          <BoardLink
            reviewId="22222222-2222-4222-8222-222222222222"
            target={{ title: "The plan", missing: false }}
          >
            the plan
          </BoardLink>
        </ReviewSessionProvider>
      </TestCanvasQuery>,
    ),
  );

  // The link alone reads nothing.
  expect(request).not.toHaveBeenCalled();

  const link = container.querySelector("a")!;

  for (let shown = 0; shown < 2; shown++) {
    await userEvent.hover(link);
    await vi.waitFor(() =>
      expect(container.querySelector("[role=tooltip]")?.textContent).toContain(
        "Opening words.",
      ),
    );
    await userEvent.unhover(link);
  }

  expect(request).toHaveBeenCalledOnce();
  expect(String(request.mock.calls[0]![0])).toContain(
    "/links/peek?board=22222222-2222-4222-8222-222222222222",
  );
});

it("reads a link's hover card again once its target was updated", async () => {
  const request = vi.fn<ReviewCanvasBridge["request"]>(
    async () =>
      new Response(JSON.stringify({ prose: ["Opening words."] }), {
        headers: { "content-type": "application/json" },
      }),
  );

  const session = testReviewSession({}, { request });
  const container = document.createElement("div");

  document.body.append(container);
  root = createRoot(container);

  const show = (updatedAt: string) =>
    act(async () =>
      root?.render(
        <TestCanvasQuery>
          <ReviewSessionProvider session={session}>
            <BoardLink
              reviewId="22222222-2222-4222-8222-222222222222"
              target={{ title: "The plan", missing: false, updatedAt }}
            >
              the plan
            </BoardLink>
          </ReviewSessionProvider>
        </TestCanvasQuery>,
      ),
    );

  const link = () => container.querySelector("a")!;

  const hover = async () => {
    await userEvent.hover(link());
    await vi.waitFor(() =>
      expect(container.querySelector("[role=tooltip]")?.textContent).toContain(
        "Opening words.",
      ),
    );
    await userEvent.unhover(link());
  };

  await show("2026-10-01T00:00:00.000Z");
  await hover();
  await hover();
  expect(request).toHaveBeenCalledOnce();

  await show("2026-10-02T00:00:00.000Z");
  await hover();
  expect(request).toHaveBeenCalledTimes(2);
});
