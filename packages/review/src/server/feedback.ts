import {
  ReviewFeedbackContactSchema,
  ReviewFeedbackSchema,
} from "@dev.fast/review-protocol";
import { reviewInstanceIdentity } from "@review/desktop-discovery";
import type { Hono } from "hono";

import { type ReviewHonoEnv, readBoundedRequestJson } from "./hono-http";

const FEEDBACK_URL = "https://dev.fast/api/feedback";

/** Runs behind the local API's auth middleware. No telemetry envelope is sent. */
export function mountFeedback(app: Hono<ReviewHonoEnv>) {
  // Dev/Preview can exercise the form against a local receiver.
  const localUrl = process.env.DEV_FAST_REVIEW_FEEDBACK_URL;

  const receiver =
    localUrl &&
    reviewInstanceIdentity(process.env).channel !== "stable" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(localUrl).hostname)
      ? localUrl
      : FEEDBACK_URL;

  for (const [path, schema] of [
    ["/feedback", ReviewFeedbackSchema],
    ["/feedback/contact", ReviewFeedbackContactSchema],
  ] as const) {
    app.post(path, async (context) => {
      const input = schema.safeParse(
        await readBoundedRequestJson(context.req.raw, 65_536),
      );

      if (!input.success)
        return context.json({ ok: false, error: "Invalid feedback." }, 400);

      const signal = AbortSignal.any([
        context.req.raw.signal,
        AbortSignal.timeout(5_000),
      ]);

      try {
        const response = await fetch(receiver, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.data),
          signal,
          redirect: "error",
        });

        const body = await response.json().catch((error) => {
          if (signal.aborted || error instanceof TypeError) throw error;

          return null;
        });

        if (!response.ok || body?.ok !== true) {
          return context.json(
            {
              ok: false,
              code: "receiver",
              error: "Feedback could not be saved. Please try again.",
            },
            502,
          );
        }

        return context.json({ ok: true });
      } catch {
        return context.json(
          {
            ok: false,
            code: "network",
            error: "Feedback could not be saved. Please try again.",
          },
          502,
        );
      }
    });
  }
}
