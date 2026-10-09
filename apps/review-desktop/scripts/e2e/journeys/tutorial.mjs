/** A reader completes every tour step, each target ringed and the guide above fullscreen tours; completion is read from storage. */
import assert from "node:assert/strict";
import path from "node:path";

import { openHome } from "../harness.mjs";
import { readApplicationStorage } from "../storage.mjs";

export const name = "tutorial";

export const phase = 1;

export const options = { seedRepo: false };

const TITLE = "Whiteboard Desktop: three-minute tour";

const PROGRESS_KEY = "review.tutorial.progress.v1";

const STEPS = [
  "chooseKeymap",
  "showHover",
  "openDiff",
  "selectLens",
  "expandFold",
  "openSequence",
  "openDatabase",
  "getHelp",
];

const progress = (ctx) => {
  const raw = readApplicationStorage(ctx.userData, PROGRESS_KEY);

  return raw ? JSON.parse(raw) : { checked: [], dismissed: false };
};

async function waitChecked(ctx, id) {
  await ctx.until(
    () => progress(ctx).checked.includes(id),
    `tutorial step ${id} checked`,
    30000,
  );
  ctx.check(`tutorial: ${id}`);
}

async function assertRinged(ctx, page, id) {
  await ctx.until(
    () =>
      page.evaluate((step) => {
        const rings = [
          ...document.querySelectorAll("[data-tutorial-ring]"),
        ].map((ring) => ring.getBoundingClientRect());

        return [
          ...document.querySelectorAll(`[data-tutorial-target="${step}"]`),
        ]
          .filter((target) => target.getClientRects().length > 0)
          .some((target) => {
            const box = target.getBoundingClientRect();

            return rings.some(
              (r) =>
                r.left <= box.left + 8 &&
                r.top <= box.top + 1 &&
                r.right >= box.right - 8 &&
                r.bottom >= box.bottom - 1,
            );
          });
      }, id),
    `a ring around the ${id} target`,
    15000,
  );
}

const guideOnTop = (page) =>
  page.evaluate(() => {
    const guide = document.querySelector('aside[aria-label="Tutorial guide"]');

    if (!guide) return false;
    const box = guide.getBoundingClientRect();

    return guide.contains(
      document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      ),
    );
  });

export async function run(ctx) {
  const { apiCanvasFor, until, root } = ctx;

  await ctx.page.keyboard.press("F1");
  await ctx.page
    .locator(".quick-input-widget input")
    .fill(">Whiteboard: Open Tutorial");
  await ctx.page
    .getByRole("option", { name: /Whiteboard: Open Tutorial/ })
    .click();

  const page = await apiCanvasFor(TITLE);

  await ctx.watchPage(page);

  const guide = page.locator('aside[aria-label="Tutorial guide"]');

  await guide.waitFor();

  // The sticky telemetry notice covers the guide's footer.
  const clearNotice = page
    .locator(".notifications-toasts")
    .getByRole("button", { name: /^Clear Notification/ });

  if (await clearNotice.count()) await clearNotice.first().click();

  const canvas = page.locator(".review-canvas-root [data-review-api]");

  const viewTab = (label) =>
    page.locator(`[aria-label="Session views"] button[aria-label="${label}"]`);

  await assertRinged(ctx, page, "chooseKeymap");

  const keybindings = page.getByRole("group", { name: "Keybindings" });

  await keybindings.getByRole("button", { name: "VS Code default" }).click();
  await until(
    async () =>
      (await keybindings
        .getByRole("button", { name: "VS Code default" })
        .getAttribute("aria-pressed")) === "true",
    "tutorial keybinding selection",
  );
  await waitChecked(ctx, "chooseKeymap");

  await assertRinged(ctx, page, "showHover");

  const editor = canvas
    .locator('[data-review-section="Welcome"] [data-review-inline-editor]')
    .first();

  await editor.locator(".view-line").first().waitFor();

  // `totalCents` is declared and used inside the authored window, so tsserver can always resolve it.
  const totalCents = editor
    .locator(".view-line span")
    .filter({ hasText: /^\s*totalCents\s*$/ })
    .first();

  await until(
    async () => {
      await page.mouse.move(0, 0);
      await totalCents.hover();
      await page.waitForTimeout(800);

      return progress(ctx).checked.includes("showHover");
    },
    "tsserver hover in the Welcome editor",
    90000,
  );
  await waitChecked(ctx, "showHover");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(root, "tutorial-hover.png") });

  await assertRinged(ctx, page, "openDiff");
  await canvas
    .locator('.tutorial-view-button[data-tutorial-view="diff"]')
    .click();
  await waitChecked(ctx, "openDiff");

  const lenses = page.locator(".diff-sidebar-lenses [data-lens-id]");

  await until(
    async () =>
      (await lenses.filter({ hasText: "Inventory reservation" }).count()) +
        (await lenses.filter({ hasText: "Payment charge" }).count()) ===
      2,
    "the tour's two lenses",
  );
  await assertRinged(ctx, page, "selectLens");
  await page.screenshot({ path: path.join(root, "tutorial-lenses.png") });
  await lenses
    .filter({ hasText: "Payment charge" })
    .locator("button[aria-pressed]")
    .click();
  await waitChecked(ctx, "selectLens");

  const fold = page
    .locator(".review-fold-pill")
    .filter({ visible: true })
    .first();

  await fold.waitFor();
  await assertRinged(ctx, page, "expandFold");
  await page.screenshot({ path: path.join(root, "tutorial-fold.png") });
  await fold.click();
  await waitChecked(ctx, "expandFold");

  await viewTab("Whiteboard").click();

  const overlay = page.locator(".diagram-tour-overlay");

  await assertRinged(ctx, page, "openSequence");
  await canvas
    .locator(".sequence-diagram .diagram-tour-button")
    .first()
    .click();
  await overlay.waitFor();
  assert.equal(
    progress(ctx).checked.includes("openSequence"),
    false,
    "opening the tour alone completed the sequence step",
  );
  await until(() => guideOnTop(page), "the guide above the sequence tour");
  await assertRinged(ctx, page, "openSequence");
  await page.screenshot({
    path: path.join(root, "tutorial-sequence-tour.png"),
  });
  await overlay.locator(".tour-pager-next").first().click();
  await waitChecked(ctx, "openSequence");
  ctx.check("the guide stays above the fullscreen sequence tour");
  await page.keyboard.press("Escape");
  await overlay.waitFor({ state: "hidden" });

  await assertRinged(ctx, page, "openDatabase");
  await canvas.locator(".database-lens .diagram-tour-button").first().click();
  await overlay.waitFor();
  await waitChecked(ctx, "openDatabase");
  await until(() => guideOnTop(page), "the guide above the database tour");
  await page.keyboard.press("Escape");
  await overlay.waitFor({ state: "hidden" });

  await assertRinged(ctx, page, "getHelp");
  await guide.getByRole("button", { name: "Finish tour" }).click();
  await waitChecked(ctx, "getHelp");

  assert.deepEqual([...progress(ctx).checked].sort(), [...STEPS].sort());
  ctx.check(
    `all ${STEPS.length} tutorial steps are checked in application storage`,
  );

  await openHome(ctx);

  const home = ctx.page.locator("main.review-home");

  // The tour step's body stays shut until the command is installed, so its note is what the rail shows.
  await home.getByText(`${STEPS.length} of ${STEPS.length} checks`).waitFor();
  ctx.check(`Welcome shows ${STEPS.length} of ${STEPS.length} checks`);

  const status = async () => (await ctx.api("/tutorial/status")).value;

  await ctx.api("/tutorial", "DELETE");

  assert.equal((await status()).reviewUuid, null);
  await ctx.api("/tutorial/prepare", "POST", {});
  await until(async () => (await status()).reviewUuid, "tutorial re-prepared");
  ctx.check("DELETE /tutorial then prepare restores the hidden review");
}
