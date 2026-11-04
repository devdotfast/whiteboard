import type { JsonValue, ReviewVerbResponse } from "@dev.fast/review-protocol";
import { describe, expect, it } from "vitest";

import type { ReviewDesktopVerbRelay } from "./global-verb-relay.js";
import { relayReviewCallbacks } from "./review-server-core.js";

const request = {
  reviewId: "8b0d2d6e-4f0a-4c0c-9a2e-1f9c1c1c1c1c",
  targetId: "block-3",
  frame: "a2",
};

function fakeRelay(
  attached: boolean,
  answer: (value: JsonValue) => ReviewVerbResponse,
): ReviewDesktopVerbRelay & { sent: JsonValue[] } {
  const sent: JsonValue[] = [];

  return {
    sent,
    attached,
    attach: () => true,
    acceptResult: () => true,
    close() {},
    onAttachedChange: () => () => {},
    async dispatch(value) {
      sent.push(value);

      return answer(value);
    },
  };
}

describe("relayReviewCallbacks.render", () => {
  it("asks the attached Desktop and keeps what the agent reads", async () => {
    const relay = fakeRelay(true, () => ({
      ok: true,
      result: {
        frame: { key: "a2", title: "Attempt 2", position: 1, count: 3 },
        scenario: "gives-up",
        rect: { x: 10, y: 20, width: 300, height: 200 },
        clipped: false,
        error: null,
        png: "aGk=",
      },
    }));

    expect(await relayReviewCallbacks(relay).render(request)).toEqual({
      frame: { key: "a2", title: "Attempt 2", position: 1, count: 3 },
      scenario: "gives-up",
      clipped: false,
      error: null,
      png: "aGk=",
    });
    expect(relay.sent).toEqual([{ name: "renderAnimation", args: request }]);
  });

  it("reports Desktop's refusal, and a missing Desktop, as 409s", async () => {
    const refused = fakeRelay(true, () => ({
      ok: false,
      error: "The whiteboard is not open in Desktop.",
    }));

    await expect(
      relayReviewCallbacks(refused).render(request),
    ).rejects.toMatchObject({
      status: 409,
      message: "The whiteboard is not open in Desktop.",
    });

    const detached = fakeRelay(false, () => ({ ok: true }));

    await expect(
      relayReviewCallbacks(detached).render(request),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("No Whiteboard Desktop is attached"),
    });
    expect(detached.sent).toEqual([]);
  });
});
