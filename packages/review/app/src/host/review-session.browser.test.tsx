import { testReviewSession } from "@canvas/review-session-test-utils";
import type {
  ReviewCanvasBridge,
  ReviewVerbRequest,
} from "@dev.fast/review-protocol";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewSessionProvider, useReviewSession } from "./review-session";

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("ReviewSessionProvider", () => {
  it("keeps mounted sessions independent when a sibling session unmounts", async () => {
    const postedA: ReviewVerbRequest[] = [];
    const postedB: ReviewVerbRequest[] = [];

    const requestA = vi.fn<NonNullable<ReviewCanvasBridge["request"]>>(
      async () => new Response(null, { status: 204 }),
    );

    const requestB = vi.fn<NonNullable<ReviewCanvasBridge["request"]>>(
      async () => new Response(null, { status: 204 }),
    );

    const sessionA = testReviewSession(
      { reviewId: "a" },
      {
        request: requestA,
        post: async (request) => {
          postedA.push(request);

          return { ok: true };
        },
      },
    );

    const sessionB = testReviewSession(
      { reviewId: "b" },
      {
        request: requestB,
        post: async (request) => {
          postedB.push(request);

          return { ok: true };
        },
      },
    );

    const containerA = document.createElement("div");
    const containerB = document.createElement("div");
    document.body.append(containerA, containerB);
    const rootA = createRoot(containerA);
    const rootB = createRoot(containerB);
    roots.push(rootA, rootB);

    await act(async () => {
      rootA.render(
        <ReviewSessionProvider session={sessionA}>
          <SessionProbe />
        </ReviewSessionProvider>,
      );
      rootB.render(
        <ReviewSessionProvider session={sessionB}>
          <SessionProbe />
        </ReviewSessionProvider>,
      );
    });

    expect(containerA.querySelector("output")?.textContent).toContain(
      "progressive-review:probe:a",
    );
    expect(containerB.querySelector("output")?.textContent).toContain(
      "progressive-review:probe:b",
    );

    await act(async () => rootA.unmount());
    roots.splice(roots.indexOf(rootA), 1);
    await act(async () => {
      containerB.querySelector("button")?.click();
    });
    await sessionB.fetch("/file");

    expect(postedA).toEqual([]);
    expect(postedB).toEqual([
      { name: "showReviewView", args: { view: "diff" } },
    ]);
    expect(requestA).not.toHaveBeenCalled();
    expect(requestB).toHaveBeenCalledWith("/reviews-api/b/file", undefined);
  });
});

function SessionProbe() {
  const session = useReviewSession();
  const [clicks, setClicks] = useState(0);

  return (
    <>
      <output>
        {session.storageKey("probe")} {clicks}
      </output>
      <button
        type="button"
        onClick={() => {
          session.surface.post({
            name: "showReviewView",
            args: { view: "diff" },
          });
          setClicks((current) => current + 1);
        }}
      >
        Open files
      </button>
    </>
  );
}
