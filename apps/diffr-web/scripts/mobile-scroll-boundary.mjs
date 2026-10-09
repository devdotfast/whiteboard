/** Against Vite: node apps/diffr-web/scripts/mobile-scroll-boundary.mjs [chromium|webkit] [seconds=0]. */
import assert from "node:assert/strict";

import { chromium, devices, webkit } from "playwright";

import { fixture } from "./mobile-fixture.mjs";

const engine = process.argv[2] ?? "chromium";

const seconds = Number(process.argv[3] ?? 0);

const browser = await { chromium, webkit }[engine].launch();

const started = Date.now();

const sizes = [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  { width: 430, height: 932 },
  { width: 760, height: 844 },
  { width: 844, height: 390 },
];

const data = fixture();

const previous = "src/group-1/file-9.ts";

const target = "src/group-2/file-12.ts";

// A long, unvisited preceding file makes an incorrect top anchor unmistakable.
for (const side of ["base", "head"])
  data.texts[side][previous] = Array.from({ length: 10 }, (_, i) =>
    data.texts[side][previous].replace(
      /process(\d+)/g,
      (_, n) => `process${i}_${n}`,
    ),
  ).join("\n\n");

let cycles = 0;

try {
  do {
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: sizes[cycles % sizes.length],
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/__ui-fixture.json", (route) =>
      route.fulfill({ json: data }),
    );
    await page.goto(
      `${process.env.DIFFR_TEST_URL ?? "http://127.0.0.1:4181"}/fixture/mobile/pull/1?ui-fixture`,
    );
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await page
      .locator(".modified .view-line")
      .first()
      .waitFor({ timeout: 60000 });
    await page
      .getByRole("button", { name: "Open file tree", exact: true })
      .tap();
    await page.waitForFunction(
      (path) =>
        [...document.querySelectorAll(".app-mobile-file-list button")].some(
          (button) =>
            button.getAttribute("aria-label") === path &&
            button
              .getAttribute("aria-description")
              ?.includes("1200 lines added"),
        ),
      previous,
    );
    await page.getByRole("button", { name: target, exact: true }).tap();
    await page.waitForTimeout(500);

    const nearEnd = async () => {
      const lines = await page.locator(".line-numbers").evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const rect = node.getBoundingClientRect();

            return (
              rect.height > 0 && rect.top > 110 && rect.top < innerHeight - 20
            );
          })
          .map((node) => Number(node.textContent)),
      );

      assert(
        lines.some((line) => line > 1600),
        `Upward scroll should enter the preceding file at its end; visible lines: ${lines}`,
      );
    };

    await page.locator(".app-native-scroll").evaluate((node) => {
      // Cancel the file-jump hold just as the start of a touch gesture does.
      node.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
      node.scrollTop -= 900;
    });
    await page.waitForTimeout(200);
    await nearEnd();

    if (engine === "chromium") {
      const cdp = await context.newCDPSession(page);
      const start = 140;
      const end = Math.min(700, sizes[cycles % sizes.length].height - 40);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 240, y: start }],
      });

      for (let y = start + 30; y <= end; y += 40) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: 240, y }],
        });
        await page.waitForTimeout(8);
      }

      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      // Playwright WebKit has no native touch-drag API; exercise the scroll bridge.
      for (let i = 0; i < 12; i++) {
        await page.locator(".app-native-scroll").evaluate((node) => {
          node.scrollTop -= 40;
        });
        await page.waitForTimeout(8);
      }
    }

    await page.waitForTimeout(1200);
    await nearEnd();
    assert.deepEqual(errors, []);
    console.log(
      `${engine}: boundary and continued upward scroll passed at ${sizes[cycles % sizes.length].width}px`,
    );
    cycles++;
    await context.close();
  } while (Date.now() - started < seconds * 1000);

  console.log(
    JSON.stringify({
      engine,
      cycles,
      seconds: Math.round((Date.now() - started) / 1000),
      errors: 0,
    }),
  );
} finally {
  await browser.close();
}
