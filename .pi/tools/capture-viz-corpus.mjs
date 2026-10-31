#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
// Capture every catalog state through real host controls on the sole managed app.
// This records evidence and geometry candidates; visual acceptance is separate.
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
const repo = path.resolve(import.meta.dirname, "../..");
const { values: opts } = parseArgs({
  options: {
    boards: { type: "string" },
    manifest: { type: "string", default: ".pi/visualizations/animation-smoke.json" },
    output: { type: "string" },
    graphics: { type: "string" },
    variants: { type: "string" },
    navigation: { type: "string", default: "step" },
    "comparison-policy": { type: "string", default: "inspired" },
  },
});
if (!opts.boards || !opts.output)
  throw Error(
    "Usage: capture-viz-corpus.mjs --boards <board-pairs.json> --output <new .pi-subagents directory>",
  );
if (!["inspired", "canonical", "exact"].includes(opts["comparison-policy"]))
  throw Error("comparison-policy must be inspired, canonical or exact");
if (!["step", "jump"].includes(opts.navigation)) throw Error("navigation must be step or jump");
const root = path.resolve(repo, opts.output);
if (!root.startsWith(path.join(repo, ".pi-subagents") + path.sep))
  throw Error("Output must be under .pi-subagents");
if (existsSync(root))
  throw Error("Use a new output directory; prior evidence is preserved");
const desktop = JSON.parse(
  execFileSync("node", [".pi/tools/desktop.mjs", "status"], {
    cwd: repo,
  }).toString(),
);
if (!desktop.ready || !desktop.identityVerified)
  throw Error("Managed Desktop is not ready");
const req = createRequire(repo + "/packages/review/package.json"),
  { Client } = req("@modelcontextprotocol/sdk/client/index.js"),
  { StdioClientTransport } = req("@modelcontextprotocol/sdk/client/stdio.js");
mkdirSync(root, { recursive: true });
const startedAt = new Date().toISOString(),
  manifest = JSON.parse(
    readFileSync(path.resolve(repo, opts.manifest)),
  ),
  boards = JSON.parse(readFileSync(path.resolve(opts.boards)));
if (opts.graphics) {
  const ids = opts.graphics.split(",");
  if (ids.some((id) => !manifest.graphics.some((g) => g.id === id)))
    throw Error("Unknown graphic selection");
  manifest.graphics = manifest.graphics.filter((g) => ids.includes(g.id));
}
if (opts.variants) {
  const ids = opts.variants.split(",");
  if (ids.some((id) => !manifest.captures.some((v) => v.key === id)))
    throw Error("Unknown variant selection");
  manifest.captures = manifest.captures.filter((v) => ids.includes(v.key));
}
const c = new Client({ name: "codex-frozen-corpus-sweep", version: "1" }),
  results = [],
  calls = [];
function save() {
  writeFileSync(
    root + "/progress.json",
    JSON.stringify(
      {
        startedAt,
        manifest: opts.manifest,
        comparisonPolicy: opts["comparison-policy"],
        updatedAt: new Date().toISOString(),
        expected: manifest.graphics.reduce(
          (n, g) => n + g.states.length * manifest.captures.length,
          0,
        ),
        captured: results.reduce((n, r) => n + (r.states?.length ?? 0), 0),
        results,
      },
      null,
      2,
    ),
  );
}
async function call(name, args) {
  const result = await c.callTool({ name, arguments: args });
  calls.push({ name, arguments: args, time: new Date().toISOString(), result });
  writeFileSync(root + "/read-open-calls.json", JSON.stringify(calls, null, 2));
  if (result.isError) throw Error(name + JSON.stringify(result));
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}
try {
  await c.connect(
    new StdioClientTransport({
      command: "node",
      args: [".pi/tools/whiteboard.mjs", "mcp"],
      cwd: repo,
    }),
  );
  for (const g of manifest.graphics) {
    const b = boards.find((b) => b.graphicId === g.id),
      node = await call("session_get", {
        sessionId: b.boardId,
        targetId: "block-1",
        format: "json",
      }),
      dir = root + "/" + g.id;
    mkdirSync(dir, { recursive: true });
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(node))
      .digest("hex");
    writeFileSync(dir + "/frozen-node.json", JSON.stringify(node, null, 2));
    for (const v of manifest.captures) {
      await call("session_open", { sessionId: b.boardId });
      execFileSync("node", [".pi/tools/desktop.mjs", "theme", v.theme], {
        cwd: repo,
        timeout: 60000,
      });
      const steps = [{ wait: 250 }, { click: "text=Whiteboard" }];
      for (const s of g.states) {
        if (g.id === "wal-replication")
          steps.push({
            frame: 'iframe[title="' + node.title + '"]',
            selector: "#drop",
            checked: Boolean(s.dropGossip),
          });
        const frame = node.frames.find((f) => f.key === s.key);
        if (!frame) throw Error("No frame " + g.id + " " + s.key);
        if (opts.navigation === "jump" && node.frames.length > 1) {
          const active = g.id === "wal-replication"
            ? node.frames.filter((f) => (s.dropGossip
              ? ["push", "commit", "dropped-gossip", "fetch", "get-200", "catch-up", "serve-after-catch-up"]
              : ["push", "commit", "gossip", "replicate", "fetch", "get-304", "serve"]).includes(f.key))
            : node.frames;
          const position = active.findIndex((f) => f.key === frame.key);
          const anchor = active.find((_, index) => Math.abs(index - position) > 1);
          if (!anchor) throw Error("No nonadjacent jump to " + g.id + "/" + frame.key + "; use step capture for motion or provide a genuine additional semantic frame");
          const selector = '[role="group"][aria-label="Steps"] button:has(span:text-is("' + anchor.label + '"))';
          steps.push({ focus: selector }, { selector, press: "Enter" });
        }
        if (node.frames.length > 1)
          steps.push(
            {
              focus:
                '[role="group"][aria-label="Steps"] button:has(span:text-is("' +
                frame.label +
                '"))',
            },
            {
              selector:
                '[role="group"][aria-label="Steps"] button:has(span:text-is("' +
                frame.label +
                '"))',
              press: "Enter",
            },
          );
        steps.push(
          { wait: 100 },
          { frame: 'iframe[title="' + node.title + '"]', settle: true },
          { shot: s.key },
        );
      }
      const stdout = execFileSync(
        "node",
        [
          ".pi/tools/desktop.mjs",
          "shot",
          "--name",
          v.key,
          "--size",
          v.width + "x" + v.height,
          "--motion",
          v.motion,
          "--selector",
          "figure",
          "--out-dir",
          dir,
          "--steps",
          JSON.stringify(steps),
        ],
        { cwd: repo, maxBuffer: 32e6, timeout: 180000 },
      ).toString();
      const shot = JSON.parse(stdout),
        states = [];
      for (const s of g.states) {
        const capture = shot.captures.find(
          (c) => c.captureId === v.key + "-" + s.key,
        );
        if (!capture)
          throw Error("Missing " + g.id + " " + v.key + " " + s.key);
        const iframe = capture.frames.find((f) => f.title === node.title);
        if (!iframe || iframe.document.stageFrameKey !== s.key)
          throw Error(
            "Wrong rendered frame " +
              g.id +
              " " +
              v.key +
              " " +
              s.key +
              " " +
              JSON.stringify(iframe?.document),
          );
        const png = readFileSync(capture.file);
        if (
          createHash("sha256").update(png).digest("hex") !== capture.pngSha256
        )
          throw Error("hash mismatch");
        const surface = iframe.surface;
        const diagnostic = {
          graphicId: g.id,
          boardId: b.boardId,
          state: s.key,
          variant: v.key,
          comparisonPolicy: opts["comparison-policy"],
          semanticSourceVariant:
            opts["comparison-policy"] === "canonical" && v.motion !== "reduce" && g.states.length > 1 ? "light-wide" : v.key,
          capturedAt: capture.capturedAt,
          theme: v.theme,
          motion: v.motion,
          shot,
        };
        writeFileSync(
          dir + "/" + s.key + "--" + v.key + ".diagnostic.json",
          JSON.stringify(diagnostic, null, 2),
        );
        states.push({
          key: s.key,
          screenshot: capture.file,
          diagnostic: dir + "/" + s.key + "--" + v.key + ".diagnostic.json",
          consoleErrors: shot.consoleErrors.length,
          textCount: surface.text.length,
          clipped: surface.clippingCandidates.length,
          boxClipped: surface.boxClippingCandidates.length,
          overlaps: surface.overlapCandidates.length,
          contrastFailures: surface.contrastFailures.length,
          sdkMotion: iframe.document.stageReducedMotion,
        });
      }
      results.push({
        graphicId: g.id,
        boardId: b.boardId,
        variant: v.key,
        payloadHash,
        states,
      });
      save();
      console.log(
        JSON.stringify({
          graphic: g.id,
          variant: v.key,
          captured: states.length,
          issues: states
            .filter(
              (s) =>
                s.consoleErrors ||
                s.clipped ||
                s.boxClipped ||
                s.contrastFailures,
            )
            .map((s) => ({
              key: s.key,
              clipped: s.clipped,
              boxClipped: s.boxClipped,
              contrast: s.contrastFailures,
              console: s.consoleErrors,
            })),
        }),
      );
    }
    const current = await call("session_get", {
      sessionId: b.boardId,
      targetId: "block-1",
      format: "json",
    });
    if (
      createHash("sha256").update(JSON.stringify(current)).digest("hex") !==
      payloadHash
    )
      throw Error("Payload changed during sweep " + g.id);
  }
} catch (e) {
  writeFileSync(
    root + "/error.json",
    JSON.stringify({
      at: new Date().toISOString(),
      error: String(e),
      stack: e.stack,
    }),
  );
  console.error(e);
  process.exitCode = 1;
} finally {
  save();
  await c.close();
}
