import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { ReviewSessionProvider } from "./host/review-session";
import { MissingCheckoutBanner } from "./missing-checkout-banner";
import { ReviewProvider } from "./review-context";
import { testReviewSession } from "./review-session-test-utils";

it("names a remote review's host and shows a failed Dismiss in the banner", async () => {
  const session = testReviewSession();
  session.review!.host = "devbox";
  session.review!.dismiss = async () => {
    throw new Error("devbox offline.");
  };

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <ReviewSessionProvider session={session}>
          <ReviewProvider>
            <MissingCheckoutBanner worktree={false} />
          </ReviewProvider>
        </ReviewSessionProvider>,
      ),
    );

    expect(container.textContent).toContain(
      "The checkout on devbox is unavailable.",
    );
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "devbox offline.",
    );
    expect(container.querySelector("button")!.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
