/** The built-in tutorial renders as a native JSON review and a reader drives every step; completion is read from storage. */
import assert from "node:assert/strict";
import path from "node:path";

import { closeSourceWindow, openHome, sourceWindowFor } from "../harness.mjs";
import { readApplicationStorage } from "../storage.mjs";

export const name = "tutorial";

export const phase = 1;

export const options = { seedRepo: false };

const TITLE = "Review Desktop: three-minute tour";

const PROGRESS_KEY = "review.tutorial.progress.v1";

/** Every step of the tour with the software map enabled, in plan order. */
const STEPS = [
  "chooseKeymap",
  "showHover",
  "gotoDefinition",
  "openPeek",
  "openCommits",
  "openDiff",
  "openSequence",
  "openMap",
  "openDatabase",
  "openTraceQuote",
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
  await page.getByRole("complementary", { name: "Tutorial guide" }).waitFor();

  const keybindings = page.getByRole("group", { name: "Keybindings" });

  await keybindings.getByRole("button", { name: "VS Code default" }).click();
  await until(
    async () =>
      (await keybindings
        .getByRole("button", { name: "VS Code default" })
        .getAttribute("aria-pressed")) === "true",
    "tutorial keybinding selection",
  );
  await page.screenshot({ path: path.join(root, "tutorial.png") });
  ctx.check(
    "native JSON tutorial renders with its guide and working keybinding picker",
  );

  const canvas = page.locator(".review-canvas-root [data-review-api]");

  const guide = page.locator(
    'aside.tutorial-guide[aria-label="Tutorial guide"]',
  );

  const viewTab = (label) =>
    page.locator(`[aria-label="Session views"] button[aria-label="${label}"]`);

  await guide.waitFor();

  // The picker's bridge checks the step before it runs the keymap command, so the render check above completed it.
  await waitChecked(ctx, "chooseKeymap");

  const editor = canvas
    .locator('[data-review-section="Welcome"] .review-inline-editor')
    .first();

  await editor.locator(".view-line").first().waitFor();

  // `inline-hover` completes on non-empty hover contents, so this is a real tsserver test.
  // Monaco pads identifier spans with the spaces around them.
  const tokens = editor
    .locator(".view-line span")
    .filter({ hasText: /^\s*[A-Za-z_]\w{2,}\s*$/ });

  const hoverText = async () =>
    (
      await page
        .locator(".monaco-hover-content")
        .allInnerTexts()
        .catch(() => [])
    )
      .join("")
      .trim();

  // A hover widget outlives the hover it showed, so the step's own record is the only reliable signal.
  const hovered = await until(
    async () => {
      const count = await tokens.count();

      for (let index = 0; index < Math.min(count, 12); index++) {
        await tokens.nth(index).hover();
        await page.waitForTimeout(600);

        if (progress(ctx).checked.includes("showHover")) return "checked";
      }

      return null;
    },
    "tsserver hover in the Welcome editor",
    60000,
  ).catch((error) => {
    if (!error.message.startsWith("Timed out waiting for")) throw error;

    return "none";
  });

  const guideNext = guide.getByRole("button", { name: "Next", exact: true });

  // `totalCents` is declared and used inside the authored window, so tsserver can always resolve it.
  const totalCents = editor
    .locator(".view-line span")
    .filter({ hasText: /^\s*totalCents\s*$/ })
    .first();

  if (hovered === "checked") {
    await waitChecked(ctx, "showHover");
    await page.keyboard.press("Escape");
    await totalCents.click();
    await page.keyboard.press("F12");
    // `inline-navigation` completes on an actual navigation.
    await waitChecked(ctx, "gotoDefinition");

    // `totalCents` is declared in the same file, so its Source window shows that file.
    await closeSourceWindow(await sourceWindowFor(ctx, "order-service.ts"));
    ctx.check("Go to Definition opens the definition in a Source window");
  } else {
    // The signature: a minute of hovers left no hover content and the step unchecked, and F12 navigates nowhere.
    assert.equal(await hoverText(), "", "a hover showed content");
    await totalCents.click();
    await page.keyboard.press("F12");
    await page.waitForTimeout(10000);
    assert.ok(
      !progress(ctx).checked.includes("gotoDefinition"),
      "Go to Definition navigated although hover had nothing",
    );
    await ctx.knownBug(
      "The tutorial's live editor gets no hover or Go to Definition",
    );

    // The sticky telemetry notice covers the guide's footer.
    const clearNotice = page
      .locator(".notifications-toasts")
      .getByRole("button", { name: /^Clear Notification/ });

    if (await clearNotice.count()) await clearNotice.first().click();

    // Next is the guide's own way past a step, so the tour can go on to the rest.
    for (const id of ["showHover", "gotoDefinition"]) {
      await guideNext.click();
      await waitChecked(ctx, id);
    }
  }

  await guide.waitFor();

  await canvas
    .locator('[data-review-section="Welcome"] a[data-review-anchor-id]')
    .first()
    .click();
  await waitChecked(ctx, "openPeek");

  await viewTab("Commits").click();
  await waitChecked(ctx, "openCommits");
  await page.locator(".review-commit-open").first().click();
  await waitChecked(ctx, "openDiff");
  await viewTab("Whiteboard").click();

  // The two `external` steps complete when the tour overlay mounts, not when the reader steps through it.
  await canvas
    .locator(
      '[data-review-section="Interactive Diagrams"] .sequence-diagram .diagram-tour-button',
    )
    .first()
    .click();
  await page.locator('[role="dialog"][aria-label$=" tour"]').waitFor();
  await waitChecked(ctx, "openSequence");
  await page.keyboard.press("Escape");

  await viewTab("Map (Experimental)").click();
  await waitChecked(ctx, "openMap");
  await viewTab("Whiteboard").click();

  await canvas
    .locator(
      '[data-review-section="Interactive Diagrams"] .database-lens .diagram-tour-button',
    )
    .first()
    .click();
  await page.locator('[role="dialog"][aria-label$=" tour"]').waitFor();
  await waitChecked(ctx, "openDatabase");
  await page.keyboard.press("Escape");

  await canvas
    .locator('[data-review-section="Agent traces"] .review-trace-quote')
    .first()
    .click();
  await waitChecked(ctx, "openTraceQuote");

  await guide.getByRole("button", { name: "Finish tour" }).click();
  await waitChecked(ctx, "getHelp");

  const final = progress(ctx);

  assert.deepEqual([...final.checked].sort(), [...STEPS].sort());
  ctx.check("all eleven tutorial steps are checked in application storage");

  await openHome(ctx);

  const home = ctx.page.locator("main.review-home");

  // The tour step's body stays shut until the command is installed, so its note is what the rail shows.
  await home.getByText(`${STEPS.length} of ${STEPS.length} checks`).waitFor();
  ctx.check("Welcome shows 11 of 11 checks");

  const status = async () => (await ctx.api("/tutorial/status")).value;

  await ctx.api("/tutorial", "DELETE");

  assert.equal((await status()).reviewUuid, null);
  await ctx.api("/tutorial/prepare", "POST", {});
  await until(async () => (await status()).reviewUuid, "tutorial re-prepared");
  ctx.check("DELETE /tutorial then prepare restores the hidden review");
}
