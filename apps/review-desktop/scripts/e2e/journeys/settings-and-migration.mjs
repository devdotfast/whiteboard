/** Settings persist across a restart; old reviews stay untouched and migration points to an agent. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { openSettings } from "../harness.mjs";
import { readUserSettings } from "../storage.mjs";

export const name = "settings-and-migration";

export const phase = 1;

export const options = { beforeLaunch: (ctx) => seedLegacyReview(ctx.home) };

const LEGACY_UUID = "11111111-1111-4111-8111-111111111111";

const LEGACY_RECORD = { schemaVersion: 1, uuid: LEGACY_UUID };

/** How a theme pick lands in workbench settings. */
const themeSettings = (theme) => ({
  "window.autoDetectColorScheme": false,
  "workbench.colorTheme": theme,
});

/** The telemetry checkbox, the only one in the Privacy section. */
const telemetryToggle = (settings) =>
  settings.getByRole("region", { name: "Privacy" }).getByRole("checkbox");

/** The theme select: its value is the `workbench.colorTheme` id. */
const themeSelect = (settings) => settings.getByRole("combobox", { name: "Theme" });

/** Writes the unreadable record into `<home>/reviews/<uuid>/review.json`. */
async function seedLegacyReview(home) {
  const dir = path.join(home, "reviews", LEGACY_UUID);

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "review.json"), JSON.stringify(LEGACY_RECORD));

  return dir;
}

const storedRecord = async (dir) =>
  JSON.parse(await readFile(path.join(dir, "review.json"), "utf8"));

export async function run(ctx) {
  const { until, userData } = ctx;

  let settings = await openSettings(ctx);

  const telemetry = telemetryToggle(settings);

  const before = await telemetry.isChecked();

  // The setting ships enabled, so the flip under test is an opt-out; this journey does not redirect the capture host.
  assert.ok(
    before,
    "the telemetry toggle started disabled, so flipping it would turn telemetry on",
  );
  await telemetry.click();
  await until(
    async () => (await telemetry.isChecked()) === !before,
    `the telemetry toggle to read ${!before}`,
  );
  // The preference is the whole effect under test; the harness runs with telemetry disabled whichever way it sits.
  await until(
    () => readUserSettings(userData)["review.telemetry.enabled"] === !before,
    `review.telemetry.enabled to be ${!before} in the workbench settings`,
  );

  const theme =
    (await themeSelect(settings).inputValue()) === "Review Light"
      ? "Review Dark"
      : "Review Light";

  await themeSelect(settings).selectOption(theme);
  await until(
    async () => (await themeSelect(settings).inputValue()) === theme,
    `the theme control to read ${theme}`,
  );
  await until(() => {
    const stored = readUserSettings(userData);

    return Object.entries(themeSettings(theme)).every(
      ([key, value]) => stored[key] === value,
    );
  }, `the ${theme} theme in the workbench settings`);

  await ctx.restartDesktop();

  settings = await openSettings(ctx);
  assert.equal(
    await telemetryToggle(settings).isChecked(),
    !before,
    "the telemetry toggle did not keep its value across the restart",
  );
  assert.equal(
    await themeSelect(settings).inputValue(),
    theme,
    "the theme control did not keep its value across the restart",
  );

  const restored = await until(
    () => readUserSettings(userData),
    "the workbench settings to be readable after the restart",
  );

  assert.equal(
    restored["review.telemetry.enabled"],
    !before,
    "review.telemetry.enabled did not survive the restart",
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(themeSettings(theme)).map((key) => [key, restored[key]]),
    ),
    themeSettings(theme),
    `the ${theme} theme settings did not survive the restart`,
  );
  ctx.check(
    "the telemetry toggle and the theme choice persist across a restart",
  );

  const legacyDir = path.join(ctx.home, "reviews", LEGACY_UUID);
  await ctx.page.locator(".review-titlebar-home").first().click();
  await ctx.page.locator("main.review-onboarding").waitFor({ timeout: 60000 });
  const summaries = await ctx.apiOk("/reviews-api");
  assert.ok(!summaries.some((summary) => summary.reviewId === LEGACY_UUID));
  assert.deepEqual(await storedRecord(legacyDir), LEGACY_RECORD);

  for (const [route, method] of [
    [`/reviews-api/${LEGACY_UUID}`, "GET"],
    [`/reviews-api/${LEGACY_UUID}/open`, "POST"],
  ]) {
    const response = await ctx.api(
      route,
      method,
      method === "POST" ? {} : undefined,
    );

    assert.equal(response.status, 404, JSON.stringify(response.value));
    assert.match(
      response.value.error,
      /ask your agent to migrate your old Whiteboard reviews/,
    );
  }

  const migrate = await ctx.cliRaw(["migrate", "apply", "--force", "--json"]);
  assert.equal(migrate.code, 1, migrate.stdout + migrate.stderr);
  assert.match(
    JSON.parse(migrate.stdout).error.message,
    /Ask your agent to migrate your old Whiteboard reviews/,
  );
  assert.deepEqual(await storedRecord(legacyDir), LEGACY_RECORD);
  ctx.check(
    "old reviews do not block startup or change on disk",
    "opening an old review and the retired migration command show agent guidance",
  );
}
