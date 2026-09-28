/** A fresh profile meets the telemetry notice and the onboarding rail; a reader with two reviews meets the community invitation once. */
import assert from "node:assert/strict";

import { assertNoBlockedReviewRequests } from "../../review-network-policy.mjs";
import { createReview, orderReviewBlocks } from "../harness.mjs";
import { readApplicationStorage } from "../storage.mjs";

export const name = "first-run";

export const phase = 1;

export const options = {
  // Restore the real first-run telemetry notice, but point capture at a closed local port.
  env: {
    DEV_FAST_REVIEW_TELEMETRY_DISABLED: "",
    PROGRESSIVE_REVIEW_POSTHOG_HOST: "http://127.0.0.1:9",
  },
  disableCommunityHandler: true,
};

const COMMUNITY_TITLE = "Join the Whiteboard community";

const COMMUNITY_DISMISSED_KEY = "review.community.dontShowAgain";

const TELEMETRY_NOTICE_KEY = "review.telemetry.noticeShown.v1";

/** Storage booleans arrive as `true`; a JSON-encoded `"true"` counts as well. */
const isStoredTrue = (value) => value === "true" || value === '"true"';

/** True when the locator turns up within `timeout`, false when it does not. */
const appears = (locator, timeout) =>
  locator.waitFor({ timeout }).then(
    () => true,
    () => false,
  );

/** The stored value for `key`, or undefined when the workbench flushed none within `timeout`. */
const storedValue = (ctx, key, timeout = 10000) =>
  ctx
    .until(
      () => readApplicationStorage(ctx.userData, key),
      `${key} in application storage`,
      timeout,
    )
    .catch((error) => {
      // Only a timeout means "nothing was stored"; the Desktop's exit diagnostic must stay fatal.
      if (!error.message.startsWith("Timed out waiting for")) throw error;

      return undefined;
    });

export async function run(ctx) {
  const { page, until, userData } = ctx;

  // Exact, because the screen-reader alert repeats the text with an "Info: " prefix.
  const notice = page.getByText(
    "Whiteboard sends anonymous usage data. You can change this in Settings.",
    { exact: true },
  );

  // Sticky, so it outlives both the seeding reload and the 10 s a plain Info toast gets.
  assert.ok(await appears(notice, 30000), "the telemetry notice never appeared");
  await page.getByRole("button", { name: "Open Settings" }).click();
  await page
    .locator(".review-settings-page")
    .getByText("Share anonymous usage data")
    .waitFor();
  ctx.check("telemetry notice opens Settings at the Privacy row");

  const tab = page
    .locator(".tabs-container .tab")
    .filter({ hasText: /^Home$/ })
    .first();

  await tab.click();

  const welcome = page.locator("main.review-home");

  await welcome.getByText("Install the whiteboard command").waitFor();
  await welcome.getByText("Connect your agents").waitFor();
  await welcome.getByText("Take the tour").waitFor();
  await welcome.getByText("Create your first session").waitFor();
  // Later steps stay shut until the command is installed, so the install step is the one open.
  await welcome.getByRole("button", { name: "Install whiteboard in PATH" }).waitFor();
  ctx.check("empty Home renders the onboarding rail");

  // The invitation waits for a reader with two reviews, so a fresh profile never sees it.
  assert.equal(
    await page.getByText(COMMUNITY_TITLE, { exact: true }).count(),
    0,
    "the community invitation showed on a fresh profile",
  );
  ctx.check("a fresh profile gets no community invitation");

  await until(
    () => readApplicationStorage(userData, TELEMETRY_NOTICE_KEY) !== undefined,
    "telemetry notice marked shown",
  );

  for (const title of ["First review", "Second review"])
    await createReview(ctx, { title, blocks: orderReviewBlocks });

  // The invitation is decided once per window, at startup.
  await ctx.restartDesktop();

  const dialog = ctx.page.getByText(COMMUNITY_TITLE, { exact: true });

  await dialog.waitFor({ timeout: 30000 });
  // Any answer is final: the invitation has no "Don't show again" of its own.
  await ctx.page.getByRole("button", { name: "Not now", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });

  const dismissed = await storedValue(ctx, COMMUNITY_DISMISSED_KEY);

  assert.ok(
    isStoredTrue(dismissed),
    `${COMMUNITY_DISMISSED_KEY} was not stored (${dismissed})`,
  );
  ctx.check("the community invitation shows once a reader has two reviews");

  await ctx.restartDesktop();
  await ctx.page.locator(".monaco-workbench").waitFor({ timeout: 60000 });
  await ctx.page.waitForTimeout(3000);
  assert.equal(
    await ctx.page.getByText(COMMUNITY_TITLE, { exact: true }).count(),
    0,
  );
  assert.equal(
    await ctx.page.getByText("Whiteboard sends anonymous usage data").count(),
    0,
  );
  ctx.check("dismissed dialog and notice stay hidden after a restart");

  assertNoBlockedReviewRequests(ctx.requestUrls);
  ctx.check("no request left for a blocked host while telemetry was live");
}
