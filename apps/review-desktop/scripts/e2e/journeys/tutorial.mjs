/** A reader finishes the tour by clicking only what the guide rings (and hovering one symbol); the guide follows each step, also above fullscreen tours. */
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
  "backToWhiteboard",
  "openSequence",
  "closeSequence",
  "openDatabase",
  "getHelp",
];

const progress = (ctx) => {
  const raw = readApplicationStorage(ctx.userData, PROGRESS_KEY);

  return raw ? JSON.parse(raw) : { checked: [], dismissed: false };
};

/** The center of a visible, ringed target of the step, scrolled into view; a ringed group yields its first button. */
const ringedPoint = (page, id) =>
  page.evaluate((step) => {
    const rings = [...document.querySelectorAll("[data-tutorial-ring]")].map(
      (ring) => ring.getBoundingClientRect(),
    );

    const ringed = (box) =>
      rings.some(
        (r) =>
          r.left <= box.left + 8 &&
          r.top <= box.top + 8 &&
          r.right >= box.right - 8 &&
          r.bottom >= box.bottom - 8,
      );

    const target = [
      ...document.querySelectorAll(`[data-tutorial-target="${step}"]`),
    ].find(
      (element) =>
        element.getClientRects().length > 0 &&
        ringed(element.getBoundingClientRect()),
    );

    if (!target) return null;

    const clickable =
      target.matches("button, a, [role=button], .review-fold-pill") ||
      target.closest("button")
        ? target
        : target.querySelector("button");

    if (!clickable) return null;
    const box = clickable.getBoundingClientRect();

    if (box.top < 0 || box.bottom > innerHeight) {
      clickable.scrollIntoView({ block: "center" });

      return null;
    }

    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, id);

const guideStep = (page) =>
  page
    .locator('aside[aria-label="Tutorial guide"]')
    .getAttribute("data-tutorial-step", { timeout: 1000 })
    .catch(() => null);

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

  const overlay = page.locator(".diagram-tour-overlay");

  /** Click whatever the guide rings until the guide moves past the step. */
  async function clickThrough(id) {
    await until(
      async () => (await guideStep(page)) === id,
      `the guide on ${id}`,
    );

    for (let clicks = 0; (await guideStep(page)) === id; clicks++) {
      assert.ok(clicks < 4, `${id} did not advance after ${clicks} clicks`);

      // Smooth scrolling moves the target; click once it holds still.
      const point = await until(
        async () => {
          const first = await ringedPoint(page, id);

          await page.waitForTimeout(250);
          const second = await ringedPoint(page, id);

          return first &&
            second &&
            Math.abs(first.x - second.x) < 1 &&
            Math.abs(first.y - second.y) < 1
            ? second
            : null;
        },
        `a ringed ${id} target`,
        15000,
      );

      await page.mouse.click(point.x, point.y);
      await until(
        async () =>
          (await guideStep(page)) !== id || (await ringedPoint(page, id)),
        `${id} to advance or ring its next target`,
        15000,
      ).catch(() => {});
      await page.waitForTimeout(300);
    }

    assert.ok(progress(ctx).checked.includes(id), `${id} is not checked`);
    ctx.check(`tutorial: ${id}`);
  }

  await clickThrough("chooseKeymap");

  // Hovering is the one step a click cannot do.
  await until(
    async () => (await guideStep(page)) === "showHover",
    "hover step",
  );

  const totalCents = page
    .locator(
      '[data-review-section="Welcome"] .modified-in-monaco-diff-editor .view-line span',
    )
    .filter({ hasText: /^\s*totalCents\s*$/ })
    .first();

  await until(
    async () => {
      await totalCents.scrollIntoViewIfNeeded();
      const box = await totalCents.boundingBox();

      await page.mouse.move(0, 0);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(800);

      return (await guide.textContent()).includes("Done.");
    },
    "tsserver hover in the Welcome editor",
    90000,
  );
  assert.ok(
    !progress(ctx).checked.includes("showHover"),
    "a confirm step advanced on its own",
  );
  await page.screenshot({ path: path.join(root, "tutorial-hover.png") });
  await page.keyboard.press("Escape");
  // The guide rings its own Next once the task is done.
  await clickThrough("showHover");

  await clickThrough("openDiff");
  await page.screenshot({ path: path.join(root, "tutorial-lenses.png") });
  await clickThrough("selectLens");
  await page.screenshot({ path: path.join(root, "tutorial-fold.png") });
  await clickThrough("expandFold");
  await clickThrough("backToWhiteboard");

  await until(
    async () => (await guideStep(page)) === "openSequence",
    "sequence step",
  );
  await page.screenshot({ path: path.join(root, "tutorial-sequence.png") });
  await clickThrough("openSequence");
  await until(() => guideOnTop(page), "the guide above the sequence tour");
  await page.screenshot({
    path: path.join(root, "tutorial-sequence-tour.png"),
  });
  ctx.check("the guide stays above the fullscreen sequence tour");
  await clickThrough("closeSequence");
  await overlay.waitFor({ state: "hidden" });

  await clickThrough("openDatabase");
  await until(() => guideOnTop(page), "the guide above the database tour");
  // The tour opens on the table's schema declaration.
  await overlay.getByText("orders schema").first().waitFor();
  await until(
    async () => (await overlay.textContent()).includes("pgTable"),
    "the schema code in the database tour",
  );
  await page.screenshot({
    path: path.join(root, "tutorial-database-tour.png"),
  });
  ctx.check("the guide stays above the fullscreen database tour");

  await guide.getByRole("button", { name: "Finish tour" }).click();
  await until(
    () => progress(ctx).checked.includes("getHelp"),
    "getHelp checked",
  );

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
