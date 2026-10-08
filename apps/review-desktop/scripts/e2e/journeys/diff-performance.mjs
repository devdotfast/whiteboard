/** Scrolling, hovering and folding a large Diff view keeps the renderer responsive. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import { createReview } from "../harness.mjs";

const exec = promisify(execFile);

export const name = "diff-performance";

export const phase = 1;

export const options = {
  env: { DEV_FAST_REVIEW_DESKTOP_BACKGROUND: "1" },
};

const TITLE = "Diff performance";

const FILES = 24;

const FUNCTIONS = 120;

const TOGGLES = 6;

const WHEEL_EVENTS = 1600;

const FLING_SPEEDS = [3000, 8000, 16000];

const FLING_DISTANCE = 40000;

const source = (file, revision) =>
  Array.from({ length: FUNCTIONS }, (_, fn) => {
    const changed = revision === "head" && fn % 4 === file % 4;

    return [
      `export function handle${file}_${fn}(order: { id: string; total: number }) {`,
      `  const label = "order-${fn}";`,
      `  if (order.total > ${fn * 10}) {`,
      `    console.log(label, order.id);`,
      `    return order.total - ${changed ? fn + 1 : fn};`,
      `  }`,
      `  for (const step of [1, 2, 3]) {`,
      `    if (step === ${fn % 3}) continue;`,
      `    order.total += step;`,
      `  }`,
      `  return order.total;`,
      `}`,
      ``,
    ].join("\n");
  }).join("\n");

export async function run(ctx) {
  const { git, until } = ctx;

  // DIFF_PERF_SOURCE=<repo> DIFF_PERF_RANGE=<base>..<head> measures a real change instead of the fixture.
  const range = process.env.DIFF_PERF_RANGE;

  let files, base, head, repoPath;

  if (range) {
    repoPath = path.join(ctx.root, "real");
    const sh = (...args) => exec("git", args, { maxBuffer: 64 * 1024 * 1024 });

    [base, head] = range.split("..");
    // A shared clone reads the source's objects in place and never writes to it.
    await sh("clone", "-q", "--shared", "--no-checkout", process.env.DIFF_PERF_SOURCE, repoPath);
    await sh("-C", repoPath, "checkout", "-q", "--detach", head);
    files = (await sh("-C", repoPath, "diff", "--name-only", base, head)).stdout
      .split("\n")
      .filter(Boolean)
      .map((file) => path.basename(file));
  } else {
    files = Array.from({ length: FILES }, (_, file) => `orders${file}.ts`);

    for (const [index, file] of files.entries())
      await writeFile(path.join(ctx.repo, file), source(index, "base"));
    await git("add", ".");
    await git("commit", "-qm", "Orders");
    base = await git("rev-parse", "HEAD");

    for (const [index, file] of files.entries())
      await writeFile(path.join(ctx.repo, file), source(index, "head"));
    await git("commit", "-qam", "Adjust orders");
    head = await git("rev-parse", "HEAD");
  }

  await createReview(ctx, { title: TITLE, base, head, repoPath, blocks: [] });

  const page = await ctx.apiCanvasFor(TITLE);

  await ctx.watchPage(page);

  await page
    .locator('[aria-label="Session views"] button[aria-label="Diff"]')
    .click();

  const rendered = page.locator(".multiDiffEntry .view-line");

  await until(
    async () => (await rendered.count()) > 0,
    "the first file's code",
    180_000,
  );

  const list = page.locator(".multiDiffEditor").first();

  const box = await list.boundingBox();

  assert.ok(
    await page.evaluate(() =>
      PerformanceObserver.supportedEntryTypes.includes("longtask"),
    ),
    "this renderer reports no long tasks",
  );
  await page.evaluate(() => {
    let probe;

    globalThis.__diffProbe = {
      start() {
        probe = { longest: 0, blocked: 0, frames: [], running: true };
        probe.observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            probe.longest = Math.max(probe.longest, entry.duration);
            probe.blocked += entry.duration;
          }
        });
        probe.observer.observe({ type: "longtask" });
        let last = performance.now();

        const frame = (now) => {
          probe.frames.push(now - last);
          last = now;

          if (probe.running) requestAnimationFrame(frame);
        };

        requestAnimationFrame(frame);
      },
      stop() {
        probe.running = false;
        probe.observer.disconnect();
        const frames = probe.frames.slice(1).sort((a, b) => a - b);

        return {
          blockedMs: Math.round(probe.blocked),
          longestTaskMs: Math.round(probe.longest),
          frames: frames.length,
          // Two or more vsyncs at 120 Hz.
          droppedFrames: frames.filter((gap) => gap > 20).length,
          slowFrames: frames.filter((gap) => gap > 50).length,
          maxFrameMs: Math.round(frames.at(-1) ?? 0),
          p95FrameMs: Math.round(frames[Math.floor(frames.length * 0.95)] ?? 0),
        };
      },
    };
  });

  const cdp = await page.context().newCDPSession(page);

  await cdp.send("Performance.enable");

  const busy = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const value = (name) => metrics.find((metric) => metric.name === name)?.value ?? 0;

    return {
      taskMs: value("TaskDuration") * 1000,
      scriptMs: value("ScriptDuration") * 1000,
      layoutMs: value("LayoutDuration") * 1000,
      styleMs: value("RecalcStyleDuration") * 1000,
      layouts: value("LayoutCount"),
    };
  };

  const measure = async (body, profile) => {
    await page.evaluate(() => globalThis.__diffProbe.start());
    const before = await busy();
    const profiler = profile && process.env.DIFF_PERF_PROFILE ? await page.context().newCDPSession(page) : undefined;

    if (profiler) {
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.start");
    }

    const started = Date.now();

    await body();
    await page.waitForTimeout(300);

    if (profiler) {
      const { profile: cpu } = await profiler.send("Profiler.stop");

      await writeFile(path.join(ctx.root, `${profile}.cpuprofile`), JSON.stringify(cpu));
    }

    const after = await busy();

    return {
      ms: Date.now() - started,
      ...Object.fromEntries(
        Object.entries(after).map(([key, value]) => [key, Math.round(value - before[key])]),
      ),
      ...(await page.evaluate(() => globalThis.__diffProbe.stop())),
    };
  };

  const timings = {};

  // The probe must see a task it should, or a quiet result proves nothing.
  const control = await measure(() =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            const until = performance.now() + 120;

            while (performance.now() < until);
            resolve();
          }, 100),
        ),
    ),
  );

  assert.ok(
    control.longestTaskMs >= 100 && control.slowFrames > 0,
    `the probe missed a 120 ms task: ${JSON.stringify(control)}`,
  );

  const pointer = { x: box.x + box.width * 0.75, y: box.y + box.height / 2 };

  const wheel = async (deltaY, pause = 8) => {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      ...pointer,
      deltaX: 0,
      deltaY,
    });

    if (pause) await page.waitForTimeout(pause);
  };

  const crossed = new Set();

  timings.scroll = await measure(async () => {
    for (let step = 0; step < WHEEL_EVENTS; step++) {
      await wheel(40);

      if (step % 50 === 0)
        for (const name of await page.locator(".multiDiffEntry .header").allInnerTexts()) {
          const file = files.find((candidate) => name.includes(candidate));

          if (file) crossed.add(file);
        }
    }

    for (let step = 0; step < WHEEL_EVENTS; step++) await wheel(-40);
  }, "scroll");
  timings.scroll.files = crossed.size;
  assert.ok(crossed.size >= 4, `the scroll crossed only ${crossed.size} files`);

  for (const speed of FLING_SPEEDS)
    timings[`fling${speed}`] = await measure(async () => {
      for (const direction of [-1, 1])
        await cdp.send("Input.synthesizeScrollGesture", {
          ...pointer,
          yDistance: direction * FLING_DISTANCE,
          speed,
          gestureSourceType: "mouse",
        });
    }, `fling${speed}`);

  await until(
    async () => (await rendered.count()) > 0,
    "code after scrolling back",
  );

  timings.hover = await measure(async () => {
    for (const x of [0.3, 0.75])
      for (let y = 10; y < box.height - 10; y += 6)
        await page.mouse.move(box.x + box.width * x, box.y + y);
  });

  // Monaco renders a few lines past the viewport, so the first pill in the DOM can be out of view.
  // The pill's editor and header line are kept, since folding can scroll the list.
  const visiblePill = () =>
    page.evaluate((list) => {
      for (const pill of document.querySelectorAll(".review-fold-pill")) {
        const rect = pill.getBoundingClientRect();

        if (rect.top < list.y + 40 || rect.bottom > list.y + list.height - 40)
          continue;
        const editor = pill.closest(".monaco-editor");
        const y = rect.y + rect.height / 2;

        const number = [...editor.querySelectorAll(".line-numbers")].find(
          (node) => {
            const box = node.getBoundingClientRect();

            return box.top <= y && y < box.bottom;
          },
        );

        if (!number) continue;
        globalThis.__foldTarget = { editor, line: Number(number.textContent) };

        return { x: rect.x + rect.width / 2, y };
      }

      return null;
    }, box);

  const toggle = async (target, unfold) => {
    await page.evaluate(() => {
      globalThis.__pressed = undefined;
      document.addEventListener(
        "pointerdown",
        () => (globalThis.__pressed = performance.now()),
        { capture: true, once: true },
      );
    });
    await page.mouse.click(target.x, target.y);

    return page.evaluate(
      (unfold) =>
        new Promise((resolve) => {
          const { editor, line } = globalThis.__foldTarget;

          const open = () =>
            [...editor.querySelectorAll(".line-numbers")].some(
              (node) => node.textContent === String(line + 1),
            );

          const tick = () => {
            if (open() === unfold) resolve(performance.now() - globalThis.__pressed);
            else requestAnimationFrame(tick);
          };

          tick();
          setTimeout(() => resolve(Number.POSITIVE_INFINITY), 10_000);
        }),
      unfold,
    );
  };

  if (!range) {
    const latencies = [];

    timings.fold = await measure(async () => {
      for (let index = 0; index < TOGGLES; index++) {
        const pill = await visiblePill();

        assert.ok(pill, "no folded scope is in view");
        latencies.push(await toggle(pill, true));

        assert.ok(latencies.at(-1) < Infinity, "the pill did not unfold");

        const headerY = await page.evaluate(() => {
          const { editor, line } = globalThis.__foldTarget;

          const rect = [...editor.querySelectorAll(".line-numbers")]
            .find((node) => node.textContent === String(line))
            .getBoundingClientRect();

          return rect.y + rect.height / 2;
        });

        await page.mouse.move(pill.x - 150, headerY);

        const chevron = await until(
          () =>
            page.evaluate((y) => {
              for (const node of globalThis.__foldTarget.editor.querySelectorAll(
                ".review-fold-chevron:not(.is-collapsed)",
              )) {
                const rect = node.getBoundingClientRect();

                if (Math.abs(rect.y + rect.height / 2 - y) < rect.height / 2)
                  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
              }

              return null;
            }, headerY),
          "the unfolded header's chevron",
        );

        latencies.push(await toggle(chevron, false));
        assert.ok(latencies.at(-1) < Infinity, "the chevron did not fold the scope");
        await page.mouse.move(box.x + 4, box.y + 4);
      }
    }, "fold");

    latencies.sort((a, b) => a - b);
    timings.fold.medianToggleMs = Math.round(latencies[latencies.length >> 1]);
    timings.fold.slowestToggleMs = Math.round(latencies.at(-1));
  }

  ctx.report.timings = timings;

  for (const [key, result] of Object.entries(timings)) {
    assert.ok(
      result.longestTaskMs < 500,
      `${key} blocked the renderer for ${result.longestTaskMs} ms in one task`,
    );

    if (key !== "fold")
      assert.ok(result.p95FrameMs < 34, `${key} ran at a p95 frame of ${result.p95FrameMs} ms`);
  }

  ctx.check(
    "scrolling, hovering and folding a many-file Diff view keeps the renderer responsive",
  );
}
