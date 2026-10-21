#!/usr/bin/env node
// Reference capture only: this launches a browser, never Whiteboard or its MCP server.
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const require = createRequire(
  path.join(root, "apps/review-desktop/package.json"),
);

const { chromium } = require("playwright");

const spec = JSON.parse(
  await readFile(path.join(root, ".pi/visualizations/cursor-git.json"), "utf8"),
);

const args = process.argv.slice(2);
const captureVersion = 3;
let preservedCaptureVersion;

const option = (name) => {
  const index = args.indexOf(name);

  return index < 0 ? undefined : args[index + 1];
};

const out = path.resolve(
  root,
  option("--output") ?? ".pi-subagents/visualization-parity/references-v3",
);

const captures = spec.captures.filter(
  (capture) => !option("--variant") || capture.key === option("--variant"),
);

const graphics = spec.graphics.filter(
  (graphic) => !option("--graphic") || graphic.id === option("--graphic"),
);

if (!captures.length || !graphics.length)
  throw new Error("Unknown --variant or --graphic");

if (args.includes("--enrich-charts") && args.includes("--refresh"))
  throw new Error(
    "--enrich-charts preserves screenshots and cannot be combined with --refresh",
  );

await mkdir(out, { recursive: true });

const inventories = [];

let results = [];

if (
  (args.includes("--resume") || args.includes("--enrich-charts")) &&
  !args.includes("--refresh")
) {
  try {
    const previous = JSON.parse(
      await readFile(path.join(out, "manifest.json"), "utf8"),
    );

    if (previous.sourceUrl === spec.sourceUrl) {
      preservedCaptureVersion = previous.captureVersion;
      if (
        !args.includes("--enrich-charts") &&
        previous.captureVersion !== captureVersion
      )
        throw new Error(
          "Reference cache uses an older capture method. Use a new --output directory or --refresh before dispatch; do not replace a running workflow's evidence.",
        );
      for (const entry of previous.captures ?? []) {
        try {
          await access(path.join(out, entry.path));
          results.push(entry);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }

      inventories.push(...(previous.inventory ?? []));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const errors = [];

async function persist() {
  const missing = spec.captures.flatMap((capture) =>
    spec.graphics.flatMap((graphic) =>
      graphic.states
        .filter(
          (state) =>
            !results.some(
              (item) =>
                item.variant === capture.key &&
                item.graphicId === graphic.id &&
                item.state === state.key,
            ),
        )
        .map((state) => ({
          variant: capture.key,
          graphicId: graphic.id,
          state: state.key,
        })),
    ),
  );

  const manifest = {
    captureVersion: args.includes("--enrich-charts")
      ? preservedCaptureVersion
      : captureVersion,
    sourceUrl: spec.sourceUrl,
    capturedAt: new Date().toISOString(),
    complete: errors.length === 0 && missing.length === 0,
    expectedCaptures:
      spec.captures.length *
      spec.graphics.reduce((sum, graphic) => sum + graphic.states.length, 0),
    inventory: inventories,
    captures: results,
    missing,
    errors,
  };

  const temporary = path.join(out, "manifest.tmp.json");
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n");
  await rename(temporary, path.join(out, "manifest.json"));
}

function readChartEvidence(element) {
  const wrapper = element.closest(".git-replica-throughput");
  const svg = element.querySelector("svg");

  if (!wrapper || !svg)
    throw new Error("Source throughput chart is not rendered");

  const matrix = (node) => {
    const value = node.getCTM();

    return {
      a: value.a,
      b: value.b,
      c: value.c,
      d: value.d,
      e: value.e,
      f: value.f,
    };
  };

  const transform = (node, x, y) => {
    const value = matrix(node);

    return {
      x: value.a * x + value.c * y + value.e,
      y: value.b * x + value.d * y + value.f,
    };
  };

  const numeric = (label) =>
    Number(label.replace("k", "")) * (label.endsWith("k") ? 1000 : 1);

  const legend = [...wrapper.querySelectorAll("li")].map((item) => ({
    label: item.textContent.trim(),
    color: getComputedStyle(item.querySelector("span")).backgroundColor,
  }));

  const ticks = [...svg.querySelectorAll("text")]
    .values()
    .filter((node) => /^\d+(?:k)?$/.test(node.textContent.trim()))
    .map((node) => ({
      label: node.textContent.trim(),
      value: numeric(node.textContent.trim()),
      anchor: node.getAttribute("text-anchor"),
      labelPosition: transform(
        node,
        Number(node.getAttribute("x")),
        Number(node.getAttribute("y")),
      ),
      transformToSvg: matrix(node),
    }))
    .toArray();

  const lines = [...svg.querySelectorAll("line")].map((node) => ({
    start: transform(
      node,
      Number(node.getAttribute("x1")),
      Number(node.getAttribute("y1")),
    ),
    end: transform(
      node,
      Number(node.getAttribute("x2")),
      Number(node.getAttribute("y2")),
    ),
  }));

  const horizontal = lines
    .filter((line) => line.start.y === line.end.y)
    .sort((a, b) => b.start.y - a.start.y);

  const yTicks = ticks
    .filter((tick) => tick.anchor === "start")
    .sort((a, b) => a.value - b.value);

  const xTicks = ticks
    .filter((tick) => tick.anchor === "middle")
    .sort((a, b) => a.value - b.value);

  if (
    yTicks.length !== horizontal.length ||
    yTicks.length < 2 ||
    xTicks.length < 2
  ) {
    throw new Error(
      "Cannot calibrate throughput axes from rendered ticks and gridlines",
    );
  }

  yTicks.forEach((tick, index) => {
    tick.gridPosition = horizontal[index].start;
  });

  const low = yTicks[0];
  const high = yTicks.at(-1);

  const unitsPerSvgUnit =
    (high.value - low.value) / (low.gridPosition.y - high.gridPosition.y);

  const displayQuantum = 10 ** (Math.floor(Math.log10(high.value)) - 3);

  const series = [...svg.querySelectorAll("path[stroke]")]
    .values()
    .filter((node) => node.getAttribute("fill") === "none")
    .map((node) => {
      const color = getComputedStyle(node).stroke;

      const points = [
        ...node
          .getAttribute("d")
          .matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/g),
      ].map((match) => {
        const point = transform(node, Number(match[1]), Number(match[2]));

        const nearestTick = xTicks.reduce((best, tick) =>
          Math.abs(tick.labelPosition.x - point.x) <
          Math.abs(best.labelPosition.x - point.x)
            ? tick
            : best,
        );

        const value =
          low.value + (low.gridPosition.y - point.y) * unitsPerSvgUnit;

        return {
          localPoint: { x: Number(match[1]), y: Number(match[2]) },
          svgPoint: point,
          replicas:
            Math.abs(nearestTick.labelPosition.x - point.x) <= 1
              ? nearestTick.value
              : null,
          approximateThroughput:
            Math.round(value / displayQuantum) * displayQuantum,
          geometricRange: [
            Math.floor(value - unitsPerSvgUnit),
            Math.ceil(value + unitsPerSvgUnit),
          ],
        };
      });

      if (!points.length || points.some((point) => point.replicas === null))
        throw new Error(
          "Source series does not align to captured replica ticks",
        );

      return {
        label: legend.find((item) => item.color === color)?.label ?? null,
        color,
        transformToSvg: matrix(node),
        points,
      };
    })
    .toArray();

  if (series.length !== 2 || series.some((entry) => entry.label === null))
    throw new Error("Cannot map both source series to their public legend");

  return {
    provenance:
      "Measured rendered SVG coordinates and public legend only; no source JavaScript or original data array accessed.",
    valuePrecision:
      "Approximate inverse-axis estimates, not exact published per-point values. geometricRange is a conservative one-SVG-unit envelope around each measured vertex, not a statistical confidence interval.",
    viewBox: svg.getAttribute("viewBox"),
    title: svg.getAttribute("aria-label"),
    legend,
    axes: {
      x: { label: "Number of replicas", ticks: xTicks },
      y: {
        label: svg.getAttribute("aria-label").startsWith("Clones")
          ? "Clones / minute"
          : "Pushes / minute",
        ticks: yTicks,
        unitsPerSvgUnit,
      },
    },
    series,
  };
}

async function chartEvidence(target, capture) {
  try {
    return await target.evaluate(readChartEvidence);
  } catch (error) {
    // Responsive charts can omit ticks. Keep their real rendering and use
    // calibrated wide variants for numeric estimates, including enrichment.
    if (capture.width >= 720) throw error;
    return {
      calibrationUnavailable: error.message,
      numericSource: "calibrated-wide-variant",
    };
  }
}

async function dismissConsent(page) {
  const reject = page.getByRole("button", { name: /^Reject\b/i }).first();
  if (!(await reject.isVisible())) return false;
  await reject.click({ timeout: 3000 });
  return true;
}

async function visibleGraphic(page, selector) {
  // CSS-visible offscreen export copies have positive bounds too. Select
  // the displayed copy in the page's horizontal layout, allowing vertical
  // scrolling but excluding fixed export surfaces around x=-10000.
  const candidates = page.locator(selector).filter({ visible: true });
  await candidates.first().waitFor({ state: "visible" });
  const viewportWidth = await page.evaluate(() => innerWidth);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    for (let i = 0; i < (await candidates.count()); i++) {
      const candidate = candidates.nth(i);
      const bounds = await candidate.boundingBox();
      if (
        bounds &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.x < viewportWidth &&
        bounds.x + bounds.width > 0
      )
        return candidate;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`No on-page source graphic matches ${selector}`);
}

async function scrollGraphic(page, selector) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const target = await visibleGraphic(page, selector);
    try {
      await target.scrollIntoViewIfNeeded();
      const bounds = await target.boundingBox();
      if (bounds && bounds.width > 0 && bounds.height > 0) return target;
    } catch (error) {
      if (!/not attached|detached/.test(error.message)) throw error;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(`Source graphic did not remain attached: ${selector}`);
}

async function waitWhileVisible(page, selector, deadline) {
  let target;
  do {
    target = await visibleGraphic(page, selector);
    const bounds = await target.boundingBox();
    const height = page.viewportSize().height;
    if (!bounds || bounds.y + bounds.height <= 0 || bounds.y >= height)
      target = await scrollGraphic(page, selector);
    const remaining = deadline - Date.now();
    if (remaining > 0) await page.waitForTimeout(Math.min(250, remaining));
  } while (Date.now() < deadline);
  return target;
}

async function applyState(page, target, state) {
  // Only public controls and browser time are used. Never access source component state.
  const toggle = target.getByRole("button", { name: "Pause", exact: true });

  if (await toggle.count()) await toggle.click();

  if (state.restoreAll) {
    const restore = target.getByRole("button", {
      name: "Restore all nodes",
      exact: true,
    });

    if (await restore.count()) await restore.click();
  }

  if (state.offline) {
    await target
      .getByRole("button", {
        name: new RegExp(`^${state.offline} is online\\.`),
      })
      .click();
  }

  if (state.dropGossip !== undefined) {
    const checkbox = target.getByRole("checkbox");

    if ((await checkbox.isChecked()) !== state.dropGossip)
      await checkbox.press("Space");

    if ((await checkbox.isChecked()) !== state.dropGossip)
      throw new Error("Gossip control did not change");
  }

  for (const [label, key] of Object.entries(state.sliders ?? {})) {
    await target.getByRole("slider", { name: label, exact: true }).press(key);
  }

  if (state.phase)
    await target
      .getByRole("button", { name: state.phase, exact: true })
      .click();

  if (state.phaseIndex !== undefined)
    await target.locator(".git-wal-phase-cell").nth(state.phaseIndex).click();
  // Let the public controls update in actual browser time.
  await page.waitForTimeout(50);

  if (state.offline) {
    await target
      .getByRole("button", { name: new RegExp(`^${state.offline} is offline`) })
      .waitFor();
  }

  if (state.restoreAll && !state.offline) {
    const offlineNodes = target.getByRole("button", { name: /is offline\./ });

    if (await offlineNodes.count())
      throw new Error("Restore all left source nodes offline");
  }

  for (const [label, key] of Object.entries(state.sliders ?? {})) {
    if (key === "End") {
      const control = target.getByRole("slider", { name: label, exact: true });

      if (
        (await control.getAttribute("aria-valuenow")) !==
        (await control.getAttribute("aria-valuemax"))
      )
        throw new Error(`Source slider did not change: ${label}`);
    }
  }
}

// Inspector runs consume this cache; only the reference setup/repair step captures.
if (!args.includes("--refresh") && !args.includes("--enrich-charts")) {
  try {
    const cached = JSON.parse(
      await readFile(path.join(out, "manifest.json"), "utf8"),
    );

    if (
      cached.sourceUrl === spec.sourceUrl &&
      cached.captureVersion !== captureVersion
    )
      throw new Error(
        "Reference cache uses an older capture method. Use a new --output directory or --refresh before dispatch; do not replace a running workflow's evidence.",
      );
    if (
      cached.sourceUrl === spec.sourceUrl &&
      cached.complete &&
      spec.captures.every((capture) =>
        spec.graphics.every((graphic) =>
          graphic.states.every((state) =>
            cached.captures.some(
              (item) =>
                item.variant === capture.key &&
                item.graphicId === graphic.id &&
                item.state === state.key,
            ),
          ),
        ),
      )
    ) {
      for (const entry of cached.captures)
        await access(path.join(out, entry.path));
      console.log(`Using complete reference cache: ${out}`);
      process.exit(0);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const lockPath = path.join(out, ".capture.lock");

let lock;

try {
  lock = await open(lockPath, "wx");
} catch (error) {
  if (error.code === "EEXIST")
    throw new Error(
      `Reference capture already owns ${lockPath}; wait for it to finish. Do not start a second capture into this output directory.`,
    );
  throw error;
}

await lock.writeFile(
  JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) +
    "\n",
);

let browser;

try {
  browser = await chromium.launch({ headless: true });

  if (args.includes("--enrich-charts")) {
    for (const capture of captures) {
      const context = await browser.newContext({
        viewport: { width: capture.width, height: capture.height },
        colorScheme: capture.theme,
        reducedMotion: capture.motion,
      });

      try {
        const page = await context.newPage();
        await page.goto(spec.sourceUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        const wrapper = await visibleGraphic(page, ".git-replica-throughput");
        await wrapper.scrollIntoViewIfNeeded();
        await wrapper.locator("svg").first().waitFor();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await dismissConsent(page);

        for (const graphic of graphics.filter((entry) =>
          entry.id.endsWith("throughput"),
        )) {
          const entry = results.find(
            (item) =>
              item.variant === capture.key &&
              item.graphicId === graphic.id &&
              item.state === "chart",
          );

          if (!entry)
            throw new Error(
              `Cannot enrich absent screenshot ${capture.key}/${graphic.id}`,
            );
          const target = await visibleGraphic(page, graphic.selector);
          entry.observed.chart = await chartEvidence(target, capture);
          await persist();
          console.log(`Chart evidence: ${capture.key}/${graphic.id}`);
        }
      } finally {
        await context.close();
      }
    }
  }

  for (const capture of captures) {
    for (const graphic of graphics) {
      if (
        graphic.states.every((state) =>
          results.some(
            (item) =>
              item.variant === capture.key &&
              item.graphicId === graphic.id &&
              item.state === state.key,
          ),
        )
      )
        continue;

      const context = await browser.newContext({
        viewport: { width: capture.width, height: capture.height },
        colorScheme: capture.theme,
        reducedMotion: capture.motion,
        deviceScaleFactor: 1,
      });

      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      let consentDismissed = false;

      try {
        // Real browser time also advances CSS/WAAPI and document timelines.
        // Fast-forwarding mocked JS time can leave these source widgets frozen.
        await page.goto(spec.sourceUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        let target = await scrollGraphic(page, graphic.selector);

        await page.evaluate(() => document.fonts.ready);

        // Source interactive code is loaded asynchronously after intersection.
        // Give hydration a real event-loop interval without skipping the first timed state.
        await new Promise((resolve) =>
          setTimeout(resolve, graphic.id === "kv-history-walk" ? 100 : 1000),
        );
        consentDismissed = await dismissConsent(page);
        target = await scrollGraphic(page, graphic.selector);

        // Wait for the public SVG; no network-idle wait is needed.
        await target.locator("svg").first().waitFor();
        // Let intersection observers activate and React hydrate the visible graphic.
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );

        if (!inventories.some((item) => item.variant === capture.key)) {
          const inventory = await page
            .locator(".interactive-wrapper, .git-replica-throughput")
            .evaluateAll((elements) =>
              elements
                .filter((element) => element.getBoundingClientRect().width > 0)
                .map((element) => ({
                  classes: element.className,
                  label:
                    element.querySelector("svg")?.getAttribute("aria-label") ??
                    null,
                })),
            );

          const unknown = inventory.filter(
            (item) =>
              !spec.graphics.some((entry) =>
                item.classes
                  .split(" ")
                  .some(
                    (className) =>
                      entry.selector.includes(`.${className}`) &&
                      className.startsWith("git-") &&
                      !["git-viz", "git-wal-demo", "git-3pc-demo"].includes(
                        className,
                      ),
                  ),
              ),
          );

          if (unknown.length)
            throw new Error(
              `Uncatalogued graphics: ${JSON.stringify(unknown)}`,
            );
          inventories.push({ variant: capture.key, graphics: inventory });
        }

        const baseline = Date.now();
        let previousSequence;
        let initialPngHash;

        for (const state of graphic.states) {
          target = await scrollGraphic(page, graphic.selector);
          await applyState(page, target, state);

          if (state.advanceMs !== undefined)
            target = await waitWhileVisible(
              page,
              graphic.selector,
              baseline + state.advanceMs,
            );

          const existing = results.find(
            (item) =>
              item.variant === capture.key &&
              item.graphicId === graphic.id &&
              item.state === state.key,
          );
          if (existing) {
            if (state.advanceMs === 0)
              initialPngHash = existing.observed.capture?.pngSha256;
            if (graphic.id === "wal-compaction" && capture.motion !== "reduce")
              previousSequence = Math.max(
                ...[...existing.observed.text.matchAll(/#(\d+)/g)].map(
                  (match) => Number(match[1]),
                ),
              );
            continue;
          }
          consentDismissed = (await dismissConsent(page)) || consentDismissed;
          const relative = `${capture.key}/${graphic.id}/${state.key}.png`;
          await mkdir(path.dirname(path.join(out, relative)), {
            recursive: true,
          });

          const readObservation = () =>
            target.evaluate((element) => ({
              text: element.innerText,
              label:
                element.querySelector("svg")?.getAttribute("aria-label") ??
                null,
              bounds: {
                width: element.getBoundingClientRect().width,
                height: element.getBoundingClientRect().height,
              },
              controls: [
                ...element.querySelectorAll(
                  'button,[role="button"],[role="slider"],input',
                ),
              ].map((control) => ({
                role:
                  control.getAttribute("role") ?? control.tagName.toLowerCase(),
                name: control.getAttribute("aria-label") ?? control.textContent,
                value: control.getAttribute("aria-valuenow"),
                valueText: control.getAttribute("aria-valuetext"),
                checked:
                  control instanceof HTMLInputElement
                    ? control.checked
                    : undefined,
              })),
            }));

          let observed = await readObservation();
          // Lazy hydration can move a widget out of view after its first frame.
          // Recover through ordinary scrolling and real time, never source state.
          for (
            let recovery = 0;
            recovery < 8 && capture.motion !== "reduce" && state.advanceMs > 0;
            recovery++
          ) {
            const count = Number(
              observed.text.match(/objects\s+(\d+)\/54/i)?.[1],
            );
            const sequence = Math.max(
              ...[...observed.text.matchAll(/#(\d+)/g)].map((match) =>
                Number(match[1]),
              ),
            );
            const stalled =
              graphic.id === "kv-history-walk"
                ? count === 0
                : graphic.id === "wal-compaction" &&
                  !(sequence > previousSequence);
            if (!stalled) break;
            target = await scrollGraphic(page, graphic.selector);
            target = await waitWhileVisible(
              page,
              graphic.selector,
              Date.now() + 250,
            );
            observed = await readObservation();
          }
          // Element screenshots resize the viewport for an oversized graphic.
          // Responsive source layout then shifts, so the old clip can capture
          // unrelated article content. CDP captures the measured document box
          // beyond the viewport without changing its responsive layout.
          const cdp = await context.newCDPSession(page);
          let pngBytes;
          let snapshot;
          const signature = (value) =>
            JSON.stringify({
              text: value.text,
              label: value.label,
              bounds: value.bounds,
              controls: value.controls,
            });
          try {
            // Keep actual browser time running. Bracket the camera with DOM
            // samples and retry a semantic transition instead of attributing
            // an earlier counter/phase to a later PNG.
            for (let attempt = 1; attempt <= 5; attempt++) {
              const beforeAt = Date.now();
              const before = await readObservation();
              const bounds = await target.boundingBox();
              if (
                !bounds ||
                bounds.width <= 0 ||
                bounds.height <= 0 ||
                bounds.x + bounds.width <= 0
              )
                throw new Error("Source graphic has no capture bounds");
              const scroll = await page.evaluate(() => ({
                x: scrollX,
                y: scrollY,
              }));
              const shot = await cdp.send("Page.captureScreenshot", {
                format: "png",
                optimizeForSpeed: true,
                captureBeyondViewport: true,
                clip: {
                  x: bounds.x + scroll.x,
                  y: bounds.y + scroll.y,
                  width: bounds.width,
                  height: bounds.height,
                  scale: 1,
                },
              });
              const after = await readObservation();
              const afterAt = Date.now();
              if (signature(before) !== signature(after)) {
                console.log(
                  JSON.stringify({
                    message: "Source changed during camera capture",
                    attempt,
                    intervalMs: afterAt - beforeAt,
                    beforeCounter: before.text.match(/OBJECTS[^\n]*/i)?.[0],
                    afterCounter: after.text.match(/OBJECTS[^\n]*/i)?.[0],
                    boundsChanged:
                      JSON.stringify(before.bounds) !==
                      JSON.stringify(after.bounds),
                  }),
                );
                continue;
              }
              observed = after;
              pngBytes = Buffer.from(shot.data, "base64");
              snapshot = {
                semanticDomStable: true,
                attempt,
                beforeSampledAt: new Date(beforeAt).toISOString(),
                afterSampledAt: new Date(afterAt).toISOString(),
                intervalMs: afterAt - beforeAt,
              };
              break;
            }
          } finally {
            await cdp.detach();
          }
          if (!pngBytes)
            throw new Error(
              "Source text/controls changed during all five camera attempts",
            );

          observed.consentDismissed = consentDismissed;
          observed.timing = {
            mode: "real-browser-time",
            hydrationDelayMs: graphic.id === "kv-history-walk" ? 100 : 1000,
            baselineAt: new Date(baseline).toISOString(),
            requestedElapsedMs: state.advanceMs ?? null,
            elapsedMs: Date.now() - baseline,
          };
          if (!(observed.bounds.width > 0 && observed.bounds.height > 0))
            throw new Error("Source observation has empty rendered bounds");
          if (graphic.id === "wal-compaction" && capture.motion !== "reduce") {
            const sequence = Math.max(
              ...[...observed.text.matchAll(/#(\d+)/g)].map((match) =>
                Number(match[1]),
              ),
            );
            if (
              !Number.isFinite(sequence) ||
              (state.advanceMs > 0 && !(sequence > previousSequence))
            )
              throw new Error(
                `Source compaction sequence did not advance: ${state.key}`,
              );
            previousSequence = sequence;
          }

          if (graphic.id.endsWith("throughput"))
            observed.chart = await chartEvidence(target, capture);

          if (graphic.id === "kv-history-walk" && capture.motion !== "reduce") {
            const count = observed.text.match(/objects\s+(\d+)\/54/i);
            if (
              !count ||
              (state.advanceMs === 0
                ? Number(count[1]) !== 0
                : Number(count[1]) === 0)
            )
              throw new Error(
                `History walk is not at its requested progress: ${state.key}`,
              );
          }

          const pngSha256 = createHash("sha256").update(pngBytes).digest("hex");
          if (state.advanceMs === 0) initialPngHash = pngSha256;
          if (
            state.advanceMs > 0 &&
            capture.motion !== "reduce" &&
            initialPngHash === pngSha256
          )
            throw new Error(`Timed source image did not advance: ${state.key}`);
          observed.capture = {
            pngSha256,
            method: "cdp-document-clip",
            viewportUnchanged: true,
            snapshot,
          };
          await writeFile(path.join(out, relative), pngBytes);

          results.push({
            graphicId: graphic.id,
            state: state.key,
            variant: capture.key,
            path: relative,
            observed,
          });
          await persist();
          console.log(`${capture.key} / ${graphic.id} / ${state.key}`);
        }
      } catch (error) {
        errors.push({
          variant: capture.key,
          graphicId: graphic.id,
          message: error.message,
        });
        await persist();
        console.error(`${capture.key} / ${graphic.id}: ${error.message}`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  try {
    if (browser) await browser.close();
    await persist();
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

if (errors.length) process.exitCode = 1;
