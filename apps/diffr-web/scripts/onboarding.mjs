/** Against Vite: node apps/diffr-web/scripts/onboarding.mjs */
import assert from "node:assert/strict";

import { chromium, webkit } from "playwright";

const origin = process.env.DIFFR_TEST_URL ?? "http://127.0.0.1:4181";

const harness = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><script type="module">
import '/src/styles.css';
import {openOnboarding} from '/src/settingsDialog.ts';
window.calls = {reload:0,replace:0};
openOnboarding({root:document.body,reload(){calls.reload++},replaceEngine(engine){calls.replace++;engine.dispose()}});
</script>`;

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();

  try {
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 390, height: 844 },
      { width: 1280, height: 900 },
    ]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/__onboarding-test", (route) =>
        route.fulfill({ contentType: "text/html", body: harness }),
      );
      await page.goto(`${origin}/__onboarding-test`);
      const button = (name) => page.getByRole("button", { name, exact: true });
      await button("Continue without token").waitFor();
      assert.notEqual(
        await page.evaluate(() => document.activeElement.tagName),
        "INPUT",
      );
      await button("Continue without token").click();
      assert.equal(await button("Not now").isVisible(), false);
      await page.getByLabel(/^API key/).fill("test-only-key");
      await page.getByLabel(/^Model/).fill("test-model");
      await button("Back").click();
      await button("Continue without token").click();
      assert.equal(
        await page.getByLabel(/^API key/).inputValue(),
        "test-only-key",
      );
      await page.getByLabel(/^Provider/).selectOption("openai");
      assert.equal(await page.getByLabel(/^API key/).inputValue(), "");
      assert.equal(await page.getByLabel(/^Model/).inputValue(), "");
      await button("Start reviewing").click();
      await page.waitForFunction(() => !document.querySelector("dialog"));
      assert.equal(
        await page.evaluate(() => localStorage.getItem("diffr.onboarded")),
        "1",
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem("diffr.summaries")),
        null,
      );
      await page.reload();
      await page.getByLabel(/^GitHub token/).fill("test-only-token");
      await button("Save token and continue").click();
      assert.equal(
        await page.evaluate(() => localStorage.getItem("diffr.githubToken")),
        "test-only-token",
      );
      assert.equal(await page.evaluate(() => calls.reload), 1);
      await page.getByLabel(/^API key/).fill("test-only-key");
      await button("Not now").click();
      await page.waitForFunction(() => !document.querySelector("dialog"));
      assert.equal(
        await page.evaluate(() => localStorage.getItem("diffr.summaries")),
        null,
      );
      // A rejected configuration must leave credentials unsaved and permit recovery.
      await page.evaluate(() =>
        localStorage.setItem("diffr.config", "[broken"),
      );
      await page.reload();
      await button("Save token and continue").click();
      await page.getByLabel(/^API key/).fill("test-only-key");
      await button("Enable summaries").click();
      await page.waitForFunction(
        () =>
          document.querySelector('[role="status"]').textContent !== "Checking…",
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem("diffr.summaries")),
        null,
      );
      assert.equal(await button("Back").isEnabled(), true);
      await page.evaluate(() => localStorage.removeItem("diffr.config"));
      await button("Enable summaries").click();
      await page.waitForFunction(() => !document.querySelector("dialog"));
      assert.equal(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("diffr.summaries")).apiKey,
        ),
        "test-only-key",
      );
      assert.equal(await page.evaluate(() => calls.replace), 1);
      assert.deepEqual(errors, []);
      console.log(
        `${name} ${viewport.width}px: skip, back, provider change, save, failure recovery passed`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
