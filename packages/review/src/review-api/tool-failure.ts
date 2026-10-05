import type {
  ReviewTelemetryErrorCategory,
  ReviewTelemetryErrorName,
} from "@review/review-telemetry.js";

import { ReviewApiError } from "./client.js";
import { ReviewInputError } from "./input-error.js";

export interface ToolFailure {
  errorName: ReviewTelemetryErrorName;
  errorCategory: ReviewTelemetryErrorCategory;
}

/**
 * Sort a failed agent tool call into the CLI's closed error vocabulary, so
 * telemetry can tell an agent's bad input from a broken host. `connect`
 * covers reaching the host and reading its catalog; `call` is the tool itself.
 */
export function toolFailure(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Catch boundary: sorts whatever a tool call threw by its class.
  error: unknown,
  phase: "connect" | "call",
): ToolFailure {
  const status =
    error instanceof ReviewApiError || error instanceof ReviewInputError
      ? error.status
      : undefined;

  if (status === 400)
    return { errorName: "usage_error", errorCategory: "user_input" };

  if (status === 401)
    return {
      errorName: "desktop_connection_error",
      errorCategory: "dependency",
    };

  if (status === 404)
    return { errorName: "review_not_found", errorCategory: "local_state" };

  if (status === 409)
    return { errorName: "review_state_error", errorCategory: "local_state" };

  if (status !== undefined)
    return { errorName: "unexpected_error", errorCategory: "internal" };

  if (phase === "connect")
    return {
      errorName: "desktop_connection_error",
      errorCategory: "dependency",
    };

  // fetch rejects with a TypeError; a command whose reply was lost is rewrapped
  // with that rejection as its cause; an abort is the agent canceling the call.
  if (
    error instanceof Error &&
    (error instanceof TypeError ||
      error.name === "AbortError" ||
      error.cause !== undefined)
  )
    return { errorName: "network_error", errorCategory: "transport" };

  return { errorName: "unexpected_error", errorCategory: "internal" };
}
