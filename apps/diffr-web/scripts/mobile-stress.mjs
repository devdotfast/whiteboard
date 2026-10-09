/** Run against Vite: node apps/diffr-web/scripts/mobile-stress.mjs [chromium|webkit] [seconds=240].
 * Uses real WASM diffing with deterministic source/summary inputs; no accounts or API keys.
 */
import assert from "node:assert/strict";

import { chromium, devices, webkit } from "playwright";

import { fixture, plugin } from "./mobile-fixture.mjs";

const engineName = process.argv[2] ?? "chromium";

const seconds = Number(process.argv[3] ?? 240);

const browser = await { chromium, webkit }[engineName].launch({
  headless: true,
});

const page = await browser.newPage({
  ...devices["iPhone 13"],
  deviceScaleFactor: 1,
});

const errors = [];

page.on("pageerror", (error) => errors.push(error.message));

const checks = {
  menus: 0,
  sheets: 0,
  folds: 0,
  swipes: 0,
  copies: 0,
  resizes: 0,
};

const sizes = [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  { width: 430, height: 844 },
  { width: 375, height: 844 },
  { width: 760, height: 844 },
  { width: 600, height: 844 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
];

const base = process.env.DIFFR_TEST_URL ?? "http://127.0.0.1:4181";

try {
  await page.addInitScript(
    (plugin) => localStorage.setItem("diffr.plugins", JSON.stringify([plugin])),
    plugin,
  );
  await page.route("**/__ui-fixture.json", (route) =>
    route.fulfill({ json: fixture() }),
  );
  await page.goto(`${base}/fixture/mobile/pull/1?ui-fixture`);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page
    .locator(".summary-fold pre:visible")
    .first()
    .waitFor({ timeout: 60000 });

  const cdp =
    engineName === "chromium"
      ? await page.context().newCDPSession(page)
      : undefined;

  if (cdp && process.env.DIFFR_CPU_RATE)
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: Number(process.env.DIFFR_CPU_RATE),
    });
  await page.evaluate(() => {
    window.stressFrames = [];
    window.stressSampling = true;
    let last = performance.now();

    const sample = (now) => {
      window.stressFrames.push(now - last);
      last = now;

      if (window.stressSampling) requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });
  const tap = (name) => page.getByRole("button", { name, exact: true }).tap();

  const swipe = async (x, y, dx, dy) => {
    if (cdp) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });

      for (let step = 1; step <= 12; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + (dx * step) / 12, y: y + (dy * step) / 12 }],
        });
        await page.waitForTimeout(16);
      }

      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      // WebKit Playwright has no native drag-touch API. Exercise the application's touch handling;
      // use the iOS simulator separately to verify native Safari scrolling.
      await page.evaluate(
        async ({ x, y, dx, dy }) => {
          const node = document.elementFromPoint(x, y);

          const fire = (type, x, y) => {
            const touches =
              type === "touchend"
                ? []
                : [
                    {
                      identifier: 1,
                      target: node,
                      clientX: x,
                      clientY: y,
                    },
                  ];

            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperties(event, {
              touches: { value: touches },
              targetTouches: { value: touches },
              changedTouches: { value: touches },
            });

            return node.dispatchEvent(event);
          };

          fire("touchstart", x, y);

          for (let step = 1; step <= 12; step++) {
            fire("touchmove", x + (dx * step) / 12, y + (dy * step) / 12);
            await new Promise(requestAnimationFrame);
          }

          fire("touchend", x + dx, y + dy);

          if (dy) document.querySelector(".app-native-scroll").scrollTop -= dy;
        },
        { x, y, dx, dy },
      );
    }

    checks.swipes++;
    await page.waitForTimeout(160);
  };

  async function inViewport(locator) {
    for (const candidate of await locator.all()) {
      const box = await candidate.boundingBox();

      if (
        box &&
        box.x < page.viewportSize().width &&
        box.y >= 110 &&
        box.y + box.height <= page.viewportSize().height - 20 &&
        (await candidate.evaluate((n) => {
          const r = n.getBoundingClientRect();

          const x =
            (Math.max(0, r.left) + Math.min(innerWidth - 5, r.right)) / 2;

          return n.contains(
            document.elementFromPoint(x, r.top + Math.min(12, r.height / 2)),
          );
        }))
      )
        return candidate;
    }

    throw new Error("No target inside the visible virtualized viewport");
  }

  const start = Date.now();
  let iteration = 0;

  while (Date.now() - start < seconds * 1000) {
    const { width, height } = sizes[iteration % sizes.length];
    await page.setViewportSize({ width, height });
    checks.resizes++;
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(() => document.body.scrollWidth),
      width,
      "page must not overflow horizontally",
    );

    for (const name of ["Display settings", "Theme settings"]) {
      await tap(name);
      await page.waitForTimeout(iteration % 2 ? 30 : 200);
      assert.equal(await page.locator(":popover-open").count(), 1);

      if (name === "Display settings")
        await page
          .getByLabel("Line numbers", { exact: true })
          .setChecked(iteration % 2 === 1);

      if (name === "Display settings" && iteration % 3 === 0) {
        await page.getByLabel("Word wrap", { exact: true }).check();
        await page.waitForTimeout(50);
        await page.getByLabel("Word wrap", { exact: true }).uncheck();
      }

      await tap(name);
      await page.waitForTimeout(230);
      assert.equal(
        await page.locator(":popover-open").count(),
        0,
        `${name}: second tap must close`,
      );
      checks.menus++;
    }

    await tap("Open file tree");
    await page.waitForTimeout(270);
    const rows = page.locator(".app-mobile-file-row");
    assert.equal(await rows.count(), 24);
    await tap("Show file search");
    const path = `src/group-${Math.floor((iteration % 24) / 6)}/file-${iteration % 24}.ts`;
    await page.getByRole("searchbox").fill(path);
    await page.evaluate(() => {
      const sheet = document.querySelector(".app-mobile-files");
      window.exitTransitions = [];

      const record = (event) => {
        if (event.target === sheet && event.propertyName === "transform")
          window.exitTransitions.push(event.type);
      };

      sheet.addEventListener("transitionrun", record);
      sheet.addEventListener("transitionend", record);
      sheet.addEventListener(
        "close",
        () => {
          sheet.removeEventListener("transitionrun", record);
          sheet.removeEventListener("transitionend", record);
        },
        { once: true },
      );
    });
    await page.getByRole("button", { name: path, exact: true }).tap();
    await page.waitForTimeout(300);
    assert.ok(
      await page.evaluate(() =>
        window.exitTransitions.includes("transitionrun"),
      ),
      "sheet must animate while dismissing",
    );
    assert.equal(await page.locator(".app-mobile-files").isVisible(), false);
    checks.sheets++;
    await page
      .locator(".summary-fold pre:visible")
      .first()
      .waitFor({ timeout: 15000 });

    const summary = await inViewport(
      page
        .locator(".summary-fold pre")
        .filter({ hasText: "Collect every matching entry" }),
    );

    const summaryBox = await summary.boundingBox();
    const summaryText = await summary.textContent();
    assert.notEqual(
      await summary.evaluate((n) => getComputedStyle(n).textOverflow),
      "ellipsis",
    );
    await swipe(
      Math.min(width - 25, summaryBox.x + summaryBox.width - 20),
      summaryBox.y + 12,
      -Math.min(160, width / 2),
      0,
    );
    assert.ok(
      await summary.evaluate(
        (n) =>
          n.scrollWidth > n.clientWidth &&
          n.scrollLeft >= Math.min(20, n.scrollWidth - n.clientWidth),
      ),
      "long summary must pan without opening the fold",
    );
    assert.equal(await summary.textContent(), summaryText);
    // A deliberate tap after panning still expands the code.
    await summary.tap();
    checks.folds++;
    await page.waitForTimeout(120);

    const longLine = await inViewport(
      page
        .locator(".modified .view-line")
        .filter({ hasText: "long code content" }),
    );

    const box = await longLine.boundingBox();
    const before = box.x;
    await swipe(width - 35, box.y + 12, -Math.min(190, width / 2), 0);
    assert.ok(
      (await longLine.boundingBox()).x < before - 20,
      "unwrapped code must pan",
    );

    // The shared horizontal thumb remains above the editor at the bottom of the viewport.
    const scrollbar = page.locator(
      ".multiDiffEditor > div > .monaco-scrollable-element > .scrollbar.horizontal",
    );

    assert.ok(
      await scrollbar.evaluate((n) => {
        const r = n.getBoundingClientRect();

        const x = r.x + Math.min(20, r.width / 2),
          y = r.y + r.height / 2;

        return (
          r.width > 0 &&
          r.height > 0 &&
          n.contains(document.elementFromPoint(x, y))
        );
      }),
      "diff must not cover the scrollbar",
    );

    const copy = await longLine.evaluate((line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      const data = new DataTransfer();
      line.dispatchEvent(
        new ClipboardEvent("copy", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );

      const result = {
        actual: data.getData("text/plain"),
        expected: line.textContent.replace(/\u00a0/g, " "),
      };

      getSelection().removeAllRanges();

      return result;
    });

    assert.equal(copy.actual, copy.expected);
    checks.copies++;
    assert.ok(
      await page
        .locator(".multiDiffEditor .scrollContent > div:first-child")
        .evaluate((n) => n.scrollLeft === 0 && n.scrollTop === 0),
      "focus must not scroll the virtual-content wrapper",
    );

    const collapse = await inViewport(
      page.locator('.modified .app-touch-fold[aria-expanded="true"]'),
    );

    assert.ok(
      await collapse.evaluate((button) => {
        const code = button
          .closest(".monaco-editor")
          .querySelector(".monaco-scrollable-element");

        return (
          button.getBoundingClientRect().right <=
          code.getBoundingClientRect().left
        );
      }),
      "fold touch targets must stay outside code with line numbers on or off",
    );

    await collapse.tap();
    await page.waitForTimeout(120);
    await inViewport(
      page
        .locator(".summary-fold pre")
        .filter({ hasText: "Collect every matching entry" }),
    );
    checks.folds++;

    const scrollBefore = await page
      .locator(".app-native-scroll")
      .evaluate((n) => n.scrollTop);

    await swipe(
      width - 60,
      Math.min(540, height - 60),
      0,
      -Math.min(260, height - 200),
    );
    assert.ok(
      (await page.locator(".app-native-scroll").evaluate((n) => n.scrollTop)) >
        scrollBefore + 80,
      "vertical scroll must continue after horizontal pan",
    );

    await tap("Open file tree");
    await page.waitForTimeout(260);
    await tap("Show file search"); // reset search for the next iteration

    if (iteration % 3 === 0) await tap("Close file tree");
    else if (iteration % 3 === 1) await page.keyboard.press("Escape");
    else await page.touchscreen.tap(10, 2);
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".app-mobile-files").isVisible(), false);
    checks.sheets++;
    assert.deepEqual(errors, []);
    iteration++;

    if (iteration % 5 === 0)
      console.log(
        JSON.stringify({
          engine: engineName,
          elapsed: Math.round((Date.now() - start) / 1000),
          iteration,
          checks,
        }),
      );
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await tap("Open file tree");
  assert.equal(
    await page
      .locator(".app-mobile-files")
      .evaluate((n) => n.getAnimations().length),
    0,
  );
  await tap("Close file tree");
  assert.equal(await page.locator(".app-mobile-files").isVisible(), false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".app-native-scroll.is-native").count(), 0);

  const timing = await page.evaluate(() => {
    window.stressSampling = false;
    const f = window.stressFrames.sort((a, b) => a - b);

    return {
      frames: f.length,
      p95: f[Math.floor(f.length * 0.95)],
      over50ms: f.filter((n) => n > 50).length,
      max: f.at(-1),
    };
  });

  console.log(
    JSON.stringify({
      result: "PASS",
      engine: engineName,
      elapsed: Math.round((Date.now() - start) / 1000),
      checks,
      timing,
      errors,
    }),
  );
} catch (error) {
  await page.screenshot({
    path: `/private/tmp/diffr-stress-failure-${engineName}.png`,
  });
  throw error;
} finally {
  await browser.close();
}
