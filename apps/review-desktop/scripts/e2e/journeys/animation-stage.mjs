/** An animation's stage runs under the workbench CSP, isolated, and shows real code peeks. */
import assert from "node:assert/strict";

import { createReview } from "../harness.mjs";

export const name = "animation-stage";

export const phase = 1;

export const options = {};

// The stage records what its sandbox let it reach, for the journey to read.
// It also builds a scene, so the journey checks that path end to end.
const HTML = [
  '<div data-wb-code="status" data-enter="change" style="margin: 0 16px"></div>',
  "<script>",
  "const s = whiteboard.scene({ columns: 2 });",
  'const order = s.actor({ id: "order", at: [1, 1], title: "order" });',
  'const queue = s.store({ id: "queue", at: [2, 1], title: "queue" });',
  's.link(order, queue, { label: "enqueue", enter: "change" });',
  's.send(order, queue, "order", "change");',
  's.on("change", queue, { note: "1 pending", tone: "added" });',
  'queue.item("order", { enter: "change", tone: "added" });',
  'whiteboard.on("change", () => whiteboard.animate("#order", [{ opacity: 0.4 }, { opacity: 1 }], 300));',
  "let parentRead = 'blocked';",
  "try { parentRead = String(window.parent.document.title); } catch {}",
  "document.body.dataset.parentRead = parentRead;",
  "fetch('https://example.com/').then(",
  "  () => { document.body.dataset.network = 'reached'; },",
  "  () => { document.body.dataset.network = 'blocked'; },",
  ");",
  "</script>",
].join("\n");

export async function run(ctx) {
  // Authoring is gated; the board below is created through the API.
  await ctx.apiOk("/preferences/animations", "PUT", { enabled: true });

  const { canvas } = await createReview(ctx, {
    title: "Animation e2e",
    blocks: [
      {
        type: "animation",
        title: "Order status",
        height: 240,
        frames: [
          { key: "before", title: "An order arrives" },
          { key: "change", title: "Its status is queued" },
        ],
        code: { status: "head/order.ts#L1" },
        html: HTML,
      },
    ],
  });

  const page = canvas.page();

  await ctx.watchPage(page);

  const figure = canvas.locator("figure.animation-block");
  const slot = figure.locator("[data-animation-slot='code']");

  await figure.waitFor();
  assert.equal(
    await figure.locator("iframe").getAttribute("sandbox"),
    "allow-scripts",
  );

  // The slot exists only once the stage ran its markup and reported layout.
  await ctx.until(
    async () => (await slot.locator(".monaco-editor").count()) > 0,
    "the stage's code placeholder to hold an inline editor",
  );
  ctx.check("the stage runs under the workbench CSP and lays out a code peek");

  const stage = await ctx.until(
    () =>
      page.frames().find((frame) => /\/stage-[^/]*\.html$/.test(frame.url())),
    "the stage frame",
  );

  const read = () =>
    stage.evaluate(() => ({
      frame: document.documentElement.dataset.frame,
      parentRead: document.body.dataset.parentRead,
      network: document.body.dataset.network,
    }));

  const sandbox = await ctx.until(
    async () => ((await read()).network ? read() : null),
    "the stage's network probe",
  );

  assert.deepEqual(sandbox, {
    frame: "before",
    parentRead: "blocked",
    network: "blocked",
  });
  ctx.check("the stage reaches neither the canvas nor the network");

  assert.equal(
    await slot.evaluate((element) => element.style.visibility),
    "hidden",
  );
  await figure.getByRole("button", { name: "Next frame" }).click();
  await ctx.until(
    async () =>
      (await read()).frame === "change" &&
      (await slot.evaluate((element) => element.style.visibility)) ===
        "visible",
    "the second frame to show the code peek",
  );
  await figure.getByText("Its status is queued").waitFor();

  // The scene laid out its cards, and a change frame reached the store.
  assert.deepEqual(
    await stage.evaluate(() => ({
      cards: document.querySelectorAll(".wb-card").length,
      queueTone: document.getElementById("queue")?.dataset.tone,
      item: document.querySelector(".wb-item")?.textContent,
    })),
    { cards: 2, queueTone: "added", item: "order" },
  );
  ctx.check("the scene lays out cards and applies a per-frame change");

  // anime.js plays the frame's segment: the chip travels to the edge's head.
  let gap = Infinity;

  await ctx.until(async () => {
    gap = await stage.evaluate(() => {
      const path = document.querySelector(".wb-line");
      const token = document.querySelector(".wb-token");

      if (!path || !token) return Infinity;
      const end = path.getPointAtLength(path.getTotalLength());
      const box = token.getBoundingClientRect();

      return Math.hypot(
        box.x + box.width / 2 - end.x,
        box.y + box.height / 2 - end.y,
      );
    });

    return gap < 2;
  }, "the chip to reach the edge's head");
  ctx.check("anime.js loads in the stage and a scene chip rides an edge");
  assert.equal(await figure.locator("[role='alert']").count(), 0);
  ctx.check("stepping a frame moves the stage and its code peek together");
}
