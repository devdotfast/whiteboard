import { testReviewBridge } from "@canvas/review-session-test-utils";
import { expect, it, vi } from "vitest";

import { createReviewSession } from "./review-session";

it("sends JSON requests to the displayed version through the host", async () => {
  const request = vi.fn<
    NonNullable<ReturnType<typeof testReviewBridge>["request"]>
  >(async () => Response.json({ text: "copied" }));

  let version = 2;

  const session = createReviewSession(testReviewBridge({}, { request }), {
    jsonReview: { id: "review/id", version: () => version },
  });

  await session.fetch("/copy-context", { method: "POST" });
  const [url] = request.mock.calls[0]!;
  expect(new URL(url, "http://localhost").pathname).toBe(
    "/reviews-api/review%2Fid/copy-context",
  );
  expect(new URL(url, "http://localhost").searchParams.get("version")).toBe(
    "2",
  );
  expect(new URL(url, "http://localhost").searchParams.has("document")).toBe(
    false,
  );

  version = 3;
  await session.fetch("/telemetry/event", { method: "POST" });
  expect(
    new URL(request.mock.calls[1]![0], "http://localhost").searchParams.get(
      "version",
    ),
  ).toBe("3");
});
