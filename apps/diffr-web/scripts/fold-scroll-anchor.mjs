/** Against Vite: node apps/diffr-web/scripts/fold-scroll-anchor.mjs [chromium|webkit]. */
import assert from "node:assert/strict";

import { chromium, devices, webkit } from "playwright";

import { fixture } from "./mobile-fixture.mjs";

const engine = process.argv[2] ?? "chromium";

const browser = await { chromium, webkit }[engine].launch();

try {
  const page = await browser.newPage({
    ...devices["iPhone 13"],
    deviceScaleFactor: 1,
  });

  await page.route("**/__ui-fixture.json", (r) =>
    r.fulfill({ json: fixture() }),
  );
  await page.goto("http://127.0.0.1:4181/fixture/mobile/pull/1?ui-fixture");
  await page
    .getByRole("button", { name: "Continue without token", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start reviewing", exact: true })
    .click();
  await page
    .locator(".modified .view-line")
    .first()
    .waitFor({ timeout: 60000 });
  await page
    .getByRole("button", { name: "Open file tree", exact: true })
    .click();
  await page
    .getByRole("button", { name: "src/group-0/file-1.ts", exact: true })
    .click();
  await page.waitForTimeout(800);
  await page.locator(".app-native-scroll").evaluate((n) => {
    n.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
    n.scrollTop -= 650;
  });
  await page.waitForTimeout(600);

  const scope = page.locator(".multiDiffEntry").filter({
    has: page.locator('[aria-label="Mark viewed: src/group-0/file-0.ts"]'),
  });

  const fold = scope.locator(
    '.modified .app-touch-fold[aria-label="Fold scope at line 155"]',
  );

  const before = await fold.boundingBox();

  const top = await page
    .locator(".app-native-scroll")
    .evaluate((n) => n.scrollTop);

  console.log("before", before, top);

  await fold.tap();
  await page.waitForTimeout(500);

  const after = await scope
    .locator('.modified .app-touch-fold[aria-label="Expand scope at line 155"]')
    .boundingBox();

  console.log(
    "after",
    after,
    await page.locator(".app-native-scroll").evaluate((n) => n.scrollTop),
  );

  assert.ok(
    Math.abs(after.y - before.y) < 2,
    `fold moved ${after.y - before.y}px`,
  );

  const next = page.locator(
    '[aria-label="Mark viewed: src/group-0/file-1.ts"]',
  );

  assert.ok(
    (await next.boundingBox()).y < 844,
    "Collapsing should bring the following file into view",
  );

  for (let i = 0; i < 12; i++) {
    await scope
      .locator(
        '.modified .app-touch-fold[aria-label="Expand scope at line 155"]',
      )
      .tap();
    await page.waitForTimeout(100);
    assert.ok(
      Math.abs((await fold.boundingBox()).y - before.y) < 2,
      "Expanding moved the fold header",
    );
    await fold.tap();
    await page.waitForTimeout(100);
    assert.ok(
      Math.abs(
        (
          await scope
            .locator(
              '.modified .app-touch-fold[aria-label="Expand scope at line 155"]',
            )
            .boundingBox()
        ).y - before.y,
      ) < 2,
      "Repeated folding moved the header",
    );
  }

  console.log(
    `${engine}: collapse reveals next file; 12 expand/collapse cycles preserve position`,
  );
} finally {
  await browser.close();
}
