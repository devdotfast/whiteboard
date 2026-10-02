import { expect, it } from "vitest";

import { ReviewApiError } from "./client.js";
import { ReviewInputError } from "./input-error.js";
import { toolFailure } from "./tool-failure.js";

it("separates agent input, review state and host failures by reply status", () => {
  expect(
    [400, 401, 404, 409, 500].map(
      (status) =>
        toolFailure(new ReviewApiError("x", status), "call").errorName,
    ),
  ).toEqual([
    "usage_error",
    "desktop_connection_error",
    "review_not_found",
    "review_state_error",
    "unexpected_error",
  ]);
  expect(
    toolFailure(new ReviewInputError("reviewId is required."), "call"),
  ).toEqual({ errorName: "usage_error", errorCategory: "user_input" });
});

it("blames the connection when the host cannot be reached", () => {
  expect(
    toolFailure(new Error("Whiteboard is not running."), "connect"),
  ).toEqual({
    errorName: "desktop_connection_error",
    errorCategory: "dependency",
  });
  expect(toolFailure(new TypeError("fetch failed"), "call")).toEqual({
    errorName: "network_error",
    errorCategory: "transport",
  });
  expect(
    toolFailure(
      new Error("Whiteboard may or may not have applied session_edit.", {
        cause: new TypeError("fetch failed"),
      }),
      "call",
    ).errorName,
  ).toBe("network_error");
});

it("reports anything else as a Whiteboard bug", () => {
  expect(toolFailure(new Error("boom"), "call")).toEqual({
    errorName: "unexpected_error",
    errorCategory: "internal",
  });
});
