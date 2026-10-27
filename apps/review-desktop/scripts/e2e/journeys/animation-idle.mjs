/** A settled animation stage schedules no frames, and the host bounds what a stage reports (#1428). */
import assert from "node:assert/strict";

import { createReview } from "../harness.mjs";

export const name = "animation-idle";

export const phase = 1;

export const options = {};

const CODE = { status: "head/order.ts#L1" };

const PLACEHOLDER = '<div data-wb-code="status" style="margin: 16px"></div>';

const frames = (...keys) => keys.map((key) => ({ key, title: key }));

/** Counts the frames the stage schedules and the slot layouts it posts over `ms`. */
const sample = (stage, ms) =>
  stage.evaluate(async (ms) => {
    const counts = { frames: 0, slots: 0 };
    const raf = window.requestAnimationFrame;
    const post = MessagePort.prototype.postMessage;

    window.requestAnimationFrame = (callback) =>
      raf.call(window, (time) => {
        counts.frames++;
        callback(time);
      });
    MessagePort.prototype.postMessage = function (message, ...rest) {
      if (message?.type === "slots") counts.slots++;

      return post.call(this, message, ...rest);
    };

    await new Promise((resolve) => setTimeout(resolve, ms));
    window.requestAnimationFrame = raf;
    MessagePort.prototype.postMessage = post;

    return counts;
  }, ms);

async function board(ctx, title, block) {
  const { canvas } = await createReview(ctx, {
    title,
    blocks: [
      {
        type: "animation",
        title,
        height: 240,
        frames: frames("a", "b"),
        code: {},
        ...block,
      },
    ],
  });

  await ctx.watchPage(canvas.page());
  const figure = canvas.locator("figure.animation-block");

  await figure.waitFor();

  const stage = await ctx.until(async () => {
    const handle = await figure.locator("iframe").elementHandle();
    const frame = await handle?.contentFrame();

    return frame && /\/stage-[^/]*\.html$/.test(frame.url()) ? frame : null;
  }, `${title}'s stage`);

  return { figure, stage, slot: figure.locator("[data-animation-slot='code']") };
}

const peekMounted = (ctx, slot, label) =>
  ctx.until(
    async () => (await slot.locator(".monaco-editor").count()) > 0,
    `${label}'s code peek`,
  );

export async function run(ctx) {
  // Authoring is gated; the boards below are created through the API.
  await ctx.apiOk("/preferences/animations", "PUT", { enabled: true });

  const idle = await board(ctx, "Idle stage", {
    code: CODE,
    html:
      PLACEHOLDER +
      '<script>whiteboard.on("b", () => whiteboard.animate("[data-wb-code]", [{ transform: "translateX(0)" }, { transform: "translateX(80px)" }], 300));</script>',
  });

  await peekMounted(ctx, idle.slot, "the idle stage");
  await idle.stage.waitForTimeout(2000);
  assert.deepEqual(await sample(idle.stage, 2000), { frames: 0, slots: 0 });
  ctx.check("a settled stage schedules no frames");

  const before = await idle.slot.evaluate((element) => element.style.transform);

  const [moving] = await Promise.all([
    sample(idle.stage, 800),
    idle.figure.getByRole("button", { name: "Next frame" }).click(),
  ]);

  assert.ok(moving.frames > 0 && moving.slots > 0, JSON.stringify(moving));
  await idle.stage.waitForTimeout(1500);
  assert.notEqual(
    await idle.slot.evaluate((element) => element.style.transform),
    before,
  );
  assert.deepEqual(await sample(idle.stage, 2000), { frames: 0, slots: 0 });
  ctx.check("a frame change moves the code peek, then the stage goes quiet");

  const jitter = await board(ctx, "Jittering stage", {
    code: CODE,
    html: [
      "<style>@keyframes jitter { from { transform: translateX(0.1px); opacity: 0.999 } to { transform: translateX(0.4px); opacity: 0.996 } }</style>",
      '<div data-wb-code="status" style="margin: 16px; animation: jitter 100ms linear infinite alternate"></div>',
    ].join(""),
  });

  await peekMounted(ctx, jitter.slot, "the jittering stage");
  await jitter.stage.waitForTimeout(1000);
  const jittering = await sample(jitter.stage, 1000);

  assert.ok(jittering.frames > 0, JSON.stringify(jittering));
  assert.equal(jittering.slots, 0);
  ctx.check("sub-pixel motion posts no slot layouts");

  const tall = await board(ctx, "Tall stage", {
    height: "auto",
    html: '<div style="height: 10000000px">Tall</div>',
  });

  // STAGE_MAX_HEIGHT in stage-protocol.ts.
  await ctx.until(
    async () =>
      (await tall.figure
        .locator("iframe")
        .evaluate((element) => element.parentElement.offsetHeight)) === 4000,
    "the tall stage to stop at the height cap",
  );
  ctx.check("an auto-sized stage stops at the height cap");

  const wanderer = await board(ctx, "Wandering stage", {
    code: CODE,
    html: PLACEHOLDER + "<script>setTimeout(() => location.reload(), 300)</script>",
  });

  await wanderer.figure.getByText("The animation left its stage.").waitFor();
  await wanderer.stage.waitForTimeout(1500);
  assert.equal(await wanderer.figure.locator("[data-animation-slot]").count(), 0);
  assert.deepEqual(
    await wanderer.stage.evaluate(() => [
      "frame" in document.documentElement.dataset,
      document.body.innerHTML,
    ]),
    [false, ""],
  );
  ctx.check("a stage that navigates away is not booted again");

  const keys = ["a", "b", "c", "d"];

  const fills = await board(ctx, "Filled stage", {
    frames: frames(...keys),
    html:
      keys
        .map((key) => `<div id="box-${key}" style="opacity: 0">${key}</div>`)
        .join("") +
      '<script>whiteboard.on("*", ({ frame }) => whiteboard.animate("#box-" + frame.key, [{ opacity: 0 }, { opacity: 1 }], 50));</script>',
  });

  for (const step of [2, 3, 4]) {
    await fills.figure.getByRole("button", { name: "Next frame" }).click();
    await ctx.until(
      async () => (await fills.figure.innerText()).includes(`${step} / 4`),
      `frame ${step} of the filled stage`,
    );
    await fills.stage.waitForTimeout(200);
  }

  const held = await fills.stage.evaluate(() => ({
    animations: document.getAnimations().length,
    first: getComputedStyle(document.querySelector("#box-a")).opacity,
  }));

  assert.ok(held.animations <= 1, JSON.stringify(held));
  assert.equal(held.first, "1");
  ctx.check("finished fills are released and keep their end state");
}
