/** Verify hovered menu triggers do not flash during dismissal. Run against Vite on port 4181. */
import assert from "node:assert/strict";

import { chromium, devices, webkit } from "playwright";

import { fixture } from "./mobile-fixture.mjs";

const base = process.env.DIFFR_TEST_URL ?? "http://127.0.0.1:4181";

for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const b = await engine.launch();

  try {
    const p = await b.newPage({
      ...devices["iPhone 13"],
      deviceScaleFactor: 1,
    });

    const data = fixture();
    data.change.files = data.change.files.slice(0, 1);
    await p.route("**/__ui-fixture.json", (r) => r.fulfill({ json: data }));
    await p.goto(`${base}/fixture/mobile/pull/1?ui-fixture`);
    await p
      .getByRole("button", { name: "Continue without token", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Start reviewing", exact: true })
      .click();
    await p.locator(".modified .view-line").first().waitFor({ timeout: 60000 });
    await p.waitForTimeout(1500);

    for (const label of ["Display settings", "Theme settings"]) {
      const button = p.getByRole("button", { name: label, exact: true });
      await button.click();
      assert.equal(await p.locator(":popover-open").count(), 1);
      await button.hover();
      await p.waitForTimeout(250);

      const color = await button.evaluate(
        (n) => getComputedStyle(n).backgroundColor,
      );

      await p.evaluate((label) => {
        window.colors = [];
        const start = performance.now();

        function sample() {
          const n = [...document.querySelectorAll(".app-header button")].find(
            (n) => n.getAttribute("aria-label") === label,
          );

          window.colors.push(getComputedStyle(n).backgroundColor);

          if (performance.now() - start < 550) requestAnimationFrame(sample);
        }

        requestAnimationFrame(sample);
      }, label);
      await button.click();
      await p.waitForTimeout(600);
      assert.equal(await p.locator(":popover-open").count(), 0);
      const colors = await p.evaluate(() => [...new Set(window.colors)]);
      console.log(name, label, { color, colors });
      assert.deepEqual(
        colors,
        [color],
        "hovered trigger must not flash while closing",
      );
    }

    await p.close();
    const loading = await b.newPage({ ...devices["iPhone 13"] });
    let release;

    const ready = new Promise((resolve) => {
      release = resolve;
    });

    await loading.route("**/__ui-fixture.json", async (route) => {
      await ready;
      await route.fulfill({ json: data });
    });
    await loading.goto(`${base}/fixture/mobile/pull/1?ui-fixture`);
    await loading
      .getByRole("button", { name: "Continue without token", exact: true })
      .click();
    await loading
      .getByRole("button", { name: "Start reviewing", exact: true })
      .click();

    const trigger = loading.getByRole("button", {
      name: "Display settings",
      exact: true,
    });

    await trigger.click();
    release();
    await loading
      .locator(".modified .view-line")
      .first()
      .waitFor({ timeout: 60000 });
    assert.equal(await loading.locator(":popover-open").count(), 1);
    await trigger.click();
    await loading.waitForFunction(
      (title) => document.querySelector(".app-title").textContent === title,
      data.change.title,
    );
    assert.equal(await loading.locator(":popover-open").count(), 0);
    console.log(name, "deferred header update: PASS");
  } finally {
    await b.close();
  }
}
