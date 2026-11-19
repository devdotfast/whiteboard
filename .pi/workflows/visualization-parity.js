// pi-subagents sandbox: runs.run only; inventory is a read-only agent run.
const manifest = args.manifest ?? ".pi/visualizations/animation-smoke.json";
const comparisonPolicy = args.comparisonPolicy ?? "inspired";
if (!["inspired", "exact", "canonical"].includes(comparisonPolicy))
  throw new Error("comparisonPolicy must be inspired, exact or canonical");
const comparisonGuidance =
  comparisonPolicy === "inspired"
    ? "Comparison policy: inspired. Use the source to understand the idea; prioritize an attractive readable animation and a flexible pleasant public API. Simplify entities, identifiers, counters and simulation depth freely while keeping your own content coherent. Exact source poses, timing, byte values and full protocols are optional. Check actual clipping, overlap, code peeks, responsive layout, motion, controls, contrast and authoring friction."
    : comparisonPolicy === "exact"
    ? "Comparison policy: exact. Match the actual cached playback pose for each state and capture variant; use public phase/progress controls for incidental timing differences, not viewport/theme business logic."
    : "Comparison policy: canonical. For incidental NORMAL-motion autoplay progress, use the recorded light-wide playback moment for each semantic state across themes/viewports. Still match the actual variant's responsive composition and intentional entity subset (for example four versus eight scaling nodes), control inputs, static data, labels and layout. Reduced-motion completion uses its own recorded source. Static chart values/series/ticks and all required semantic states remain strict. This only normalizes incidental clock progress; it never excuses missing content, wrong topology, clipping, bad contrast or invalid protocol behavior.";
const maxRounds = args.maxRounds ?? 4;
if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 12)
  throw new Error("maxRounds must be 1..12");
const startedAt = Date.now();
const dir =
  ".pi-subagents/visualization-parity/" +
  Date.now().toString(36) +
  "-" +
  Math.random().toString(36).slice(2, 10);
const text = { type: "string", minLength: 1 };
const strings = { type: "array", items: text };
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const array = (items) => ({ type: "array", minItems: 1, items });
const inventoryRun = await runs.run("inventory", {
  agent: "viz-evidence-validator",
  label: "Read corpus deterministically",
  task:
    "<viz-validation-json>" +
    JSON.stringify({ mode: "inventory-read", manifest, startedAt }) +
    "</viz-validation-json>",
});
if (!inventoryRun.ok)
  return {
    verdict: "inventory-failed",
    complete: false,
    dir,
    error: inventoryRun.error,
  };
let inventory;
try {
  inventory = { structuredOutput: JSON.parse(inventoryRun.output).inventory };
} catch {
  return {
    verdict: "inventory-failed",
    complete: false,
    dir,
    error: "Invalid inventory command JSON",
  };
}
if (!inventory.structuredOutput)
  return {
    verdict: "inventory-failed",
    complete: false,
    dir,
    error: "No inventory returned",
  };
function validateEvidence(key, payload) {
  return runs
    .run("validate-" + key, {
      agent: "viz-evidence-validator",
      label: "Validate on-disk evidence: " + key,
      task:
        "<viz-validation-json>" +
        JSON.stringify({
          ...payload,
          comparisonPolicy,
          auditRoot: dir,
          auditPath: dir + "/validation/" + key + ".json",
          manifest,
          startedAt,
          references:
            args.references ??
            ".pi-subagents/visualization-parity/references-v3",
        }) +
        "</viz-validation-json>",
    })
    .then((result) => {
      if (!result.ok)
        return {
          pass: false,
          failures: [result.error ?? "Validator command failed"],
        };
      try {
        return JSON.parse(result.output);
      } catch {
        return { pass: false, failures: ["Validator emitted invalid JSON"] };
      }
    });
}
const inventoryValidation = await validateEvidence("inventory", {
  mode: "inventory",
  inventory: inventory.structuredOutput,
});
if (!inventoryValidation.pass)
  return {
    verdict: "inventory-invalid",
    complete: false,
    dir,
    failures: inventoryValidation.failures,
  };
const corpus = inventory.structuredOutput;
const unique = (xs) => new Set(xs).size === xs.length;
const safe = (key) => /^[a-z0-9][a-z0-9-]*$/.test(key);
if (
  !unique(corpus.graphics.map((g) => g.id)) ||
  !unique(corpus.captures.map((c) => c.key)) ||
  !unique(corpus.checks)
)
  throw new Error("Duplicate corpus keys");
for (const g of corpus.graphics)
  if (
    !safe(g.id) ||
    !unique(g.states.map((s) => s.key)) ||
    g.states.some((s) => !safe(s.key)) ||
    !unique(g.checks)
  )
    throw new Error("Invalid graphic inventory");
if (corpus.captures.some((c) => !safe(c.key)))
  throw new Error("Invalid capture keys");
const authorSchema = obj({
  status: { enum: ["authored", "blocked"] },
  boardId: text,
  artifact: text,
  summary: text,
});
const inspectSchema = obj({
  verdict: { enum: ["pass", "fail"] },
  report: text,
  summary: text,
});
const improveSchema = obj({
  status: { enum: ["changed", "author-retry", "blocked"] },
  summary: text,
  files: strings,
});
const restartSchema = obj({
  status: { enum: ["ready", "exited", "timeout"] },
  errors: { type: "array", items: obj({ file: text, excerpt: text }) },
  summary: text,
});

function restart(key) {
  return runs
    .run("restart-" + key, {
      agent: "viz-desktop-restarter",
      label: "Restart sole Whiteboard instance",
      task: (key === "initial" ? "Read helper status first. Reuse the current identity-verified ready managed instance without rebuilding. If it is not ready, " : "After the shared product change, ") + "run the guarded helper restart once when required. Enforce single-instance and MCP-port ownership checks. Use pnpm dev only; fail closed if an unknown process owns the port. Report ready only after ownership/readiness checks; errors use {file,excerpt}.",
      outputSchema: restartSchema,
      output: dir + "/restart-" + key + ".json",
    })
    .then((run) => {
      const boot = run.structuredOutput;
      return run.ok && boot?.status === "ready" && boot.errors.length === 0
        ? null
        : (boot ?? run.error ?? "Restart failed");
    });
}
const referencePreflight = await validateEvidence("reference-preflight", {
  mode: "final",
});
if (!referencePreflight.pass)
  return {
    verdict: "references-incomplete",
    complete: false,
    dir,
    failures: referencePreflight.failures,
  };
const initial = await restart("initial");
if (initial)
  return { verdict: "restart-failed", complete: false, dir, error: initial };
const rounds = [];
const feedback = new Map(Object.entries(args.feedback ?? {}));
for (const [id, value] of feedback)
  if (
    !corpus.graphics.some((graphic) => graphic.id === id) ||
    typeof value !== "string"
  )
    throw new Error(
      "Feedback must map manifest graphic ids to prior report paths or corrections",
    );
let revision = 0;
const accepted = new Map();
const acceptedEvidence = new Map();
const priorAttempts = new Map();
for (let round = 1; round <= maxRounds; round++) {
  const startingRevision = revision;
  let allPassed = true;
  // Keep validated passes only at this API revision. Author-only retries do
  // not invalidate other boards; a shared API edit invalidates the whole cache.
  for (const graphic of corpus.graphics) {
    if (accepted.get(graphic.id)?.revision === revision) continue;
    const root = dir + "/round-" + round + "/" + graphic.id;
    const reference = JSON.stringify({
      sourceUrl: corpus.sourceUrl,
      graphic,
      captures: corpus.captures,
    });
    const author = await runs.run("author-" + round + "-" + graphic.id, {
      agent: "viz-author",
      label: "MCP author: " + graphic.title,
      task: [
        "Read .pi/visualization-rules.md and " + manifest + ".",
        "Recreate this graphic through the running Whiteboard real MCP API and current public authoring guidance.",
        "Read cached source evidence only at " +
          (args.references ??
            ".pi-subagents/visualization-parity/references-v3") +
          "/manifest.json. Never invoke the source capture helper or overwrite reference artifacts.",
        reference,
        comparisonGuidance,
        "Record comparisonPolicy: " +
          comparisonPolicy +
          " in the author trace.",
        "Write call trace and board/block ids under " +
          root +
          "/author/trace.json. Return this exact trace path as artifact, not the runtime summary output. Exact manifest graphicId: " +
          graphic.id +
          ". Keep created block ids separate; fresh artifacts for this attempt.",
        "Additional user goals: " + (args.task ?? "none"),
        "Prior attempt (reuse its working payload through MCP; this is not accepted evidence): " +
          JSON.stringify(priorAttempts.get(graphic.id) ?? null),
        "Prior feedback: " + (feedback.get(graphic.id) ?? "none"),
      ].join("\n"),
      outputSchema: authorSchema,
      output: root + "/author.json",
    });
    if (!author.ok || !author.structuredOutput)
      return {
        verdict: "author-failed",
        complete: false,
        dir,
        rounds,
        error: author.error,
      };
    if (author.structuredOutput.status === "blocked")
      return {
        verdict: "author-blocked",
        complete: false,
        dir,
        rounds,
        graphic: graphic.id,
        author: author.structuredOutput,
        authorRunId: author.runId,
        reason:
          "Author could not use the required MCP authoring path; resolve the reported connection or API blocker before inspection.",
      };
    const authorEvidence = await validateEvidence(
      "author-" + round + "-" + graphic.id,
      {
        mode: "author",
        graphicId: graphic.id,
        author: author.structuredOutput,
        authorRunId: author.runId,
        authorRoot: root + "/author",
      },
    );
    if (!authorEvidence.pass)
      return {
        verdict: "author-contract-invalid",
        complete: false,
        dir,
        rounds,
        graphic: graphic.id,
        failures: authorEvidence.failures,
      };
    const expected = graphic.states.flatMap((s) =>
      corpus.captures.map((c) => s.key + "--" + c.key),
    );
    const rules = [...new Set([...corpus.checks, ...graphic.checks])];
    const inspectRoot = root + "/inspect";
    const reportPath = inspectRoot + "/report.json";
    const inspect = await runs.run("inspect-" + round + "-" + graphic.id, {
      agent: "viz-inspector",
      label: "Visual smoke: " + graphic.title,
      task: [
        "Read .pi/visualization-rules.md and " +
          manifest +
          " (including state action metadata).",
        reference,
        comparisonGuidance,
        "Each diagnostic must record comparisonPolicy: " +
          comparisonPolicy +
          "; semanticSourceVariant is light-wide for canonical normal multi-state playback, otherwise the actual variant key. This field identifies playback alignment only; responsive entity subsets/layout and static data still use the actual variant.",
        "Read .pi/visualization-report.schema.json BEFORE writing the full report; every saved field must match this exact schema. All evidence paths must be inside this inspection directory.",
        "Author result: " + JSON.stringify(author.structuredOutput),
        "Native author run UUID: " +
          author.runId +
          ". Early host author audit: " +
          authorEvidence.auditPath +
          ". Read its nativeProofs calls and hashes for actual MCP provenance; trace.json calls are optional and not authoritative. Copy the audit into this inspection directory before citing it.",
        "Read cached source evidence only at " +
          (args.references ??
            ".pi-subagents/visualization-parity/references-v3") +
          "/manifest.json. Never invoke the source capture helper or overwrite reference artifacts.",
        "Required captures: " + JSON.stringify(expected),
        "Required rules for EVERY capture: " + JSON.stringify(rules),
        "Save distinct screenshot/diagnostic files under " +
          inspectRoot +
          "/. Write the FULL exhaustive captures/checks/findings JSON directly to " +
          inspectRoot +
          "/report.json. Return only {verdict,report:<actual full report JSON path>,summary}. No placeholders or abbreviated check rows. Unknown or unreachable fails.",
      ].join("\n"),
      outputSchema: inspectSchema,
      output: root + "/inspection.json",
    });
    if (!inspect.ok || !inspect.structuredOutput)
      return {
        verdict: "inspection-failed",
        complete: false,
        dir,
        rounds,
        error: inspect.error,
      };
    const evidenceValidation = await validateEvidence(
      round + "-" + graphic.id,
      {
        mode: "inspection",
        graphicId: graphic.id,
        author: author.structuredOutput,
        authorRunId: author.runId,
        reportPath: reportPath,
        authorRoot: root + "/author",
        inspectionRoot: inspectRoot,
      },
    );
    const report = evidenceValidation.report ?? {
      verdict: "fail",
      findings: [],
    };
    const failures = evidenceValidation.pass ? [] : evidenceValidation.failures;
    if (author.structuredOutput.status !== "authored")
      failures.push("Author blocked");
    rounds.push({
      round,
      graphic: graphic.id,
      boardId: author.structuredOutput.boardId,
      authorArtifact: author.structuredOutput.artifact,
      revision,
      verdict: failures.length ? "fail" : "pass",
      failureCount: evidenceValidation.failureCount ?? failures.length,
      failures: failures.slice(0, 5),
      auditPath: evidenceValidation.auditPath,
      report: reportPath,
    });
    priorAttempts.set(graphic.id, {
      boardId: author.structuredOutput.boardId,
      artifact: author.structuredOutput.artifact,
      report: reportPath,
      verdict: failures.length ? "fail" : "pass",
      revision,
    });
    if (!failures.length) {
      accepted.set(graphic.id, rounds.at(-1));
      acceptedEvidence.set(graphic.id, {
        mode: "inspection",
        graphicId: graphic.id,
        author: author.structuredOutput,
        authorRunId: author.runId,
        reportPath,
        authorRoot: root + "/author",
        inspectionRoot: inspectRoot,
      });
      feedback.delete(graphic.id);
      continue;
    }
    allPassed = false;
    feedback.set(
      graphic.id,
      JSON.stringify({
        failureCount: evidenceValidation.failureCount ?? failures.length,
        failures,
        auditPath: evidenceValidation.auditPath,
        findingCount: report.findingCount ?? report.findings.length,
        findings: report.findings,
        report: reportPath,
      }),
    );
    const improvement = await runs.run("improve-" + round + "-" + graphic.id, {
      agent: "viz-api-improver",
      label: "Resolve API limitations: " + graphic.title,
      task: [
        comparisonGuidance,
        "Read shared API review notes at " +
          dir +
          "/root-api-notes.md if present; address pending assigned reusable improvements and preserve old receipts.",
        "Read .pi/visualization-rules.md. Read every failure in audit " +
          evidenceValidation.auditPath +
          " and every finding in the actual inspection report " +
          reportPath +
          ". Compact feedback below is only a preview.",
        "Read MCP author trace under " +
          root +
          " and FULL inspection report at " +
          reportPath,
        feedback.get(graphic.id),
        "Classify authored misuse, reusable API/runtime defects, and reference uncertainty. Fix reusable defects only. Return author-retry for author corrections, blocked for uncertainty.",
      ].join("\n"),
      outputSchema: improveSchema,
      output: root + "/improvement.json",
    });
    if (!improvement.ok || !improvement.structuredOutput)
      return {
        verdict: "improvement-failed",
        complete: false,
        dir,
        rounds,
        error: improvement.error,
      };
    const change = improvement.structuredOutput;
    if (change.status === "blocked")
      return {
        verdict: "blocked",
        complete: false,
        dir,
        rounds,
        reason: change.summary,
      };
    feedback.set(
      graphic.id,
      feedback.get(graphic.id) + "\nImprover: " + change.summary,
    );
    if (change.status === "changed") {
      const evidenceOnly =
        change.files.length > 0 &&
        change.files.every((file) =>
          file.replace(/^\.\//, "").startsWith(".pi/"),
        );
      if (evidenceOnly) {
        // Harness repairs change adjudication, not the rendered app. Re-run
        // the current validator against original receipts and captures.
        for (const [id, payload] of acceptedEvidence) {
          const audit = await validateEvidence(
            "recheck-" + round + "-" + graphic.id + "-" + id,
            payload,
          );
          if (!audit.pass) {
            accepted.delete(id);
            acceptedEvidence.delete(id);
            feedback.set(
              id,
              JSON.stringify({
                report: payload.reportPath,
                failures: audit.failures,
                auditPath: audit.auditPath,
              }),
            );
          }
        }
        continue;
      }
      revision++;
      accepted.clear();
      acceptedEvidence.clear();
      const error = await restart(round + "-" + graphic.id);
      if (error)
        return {
          verdict: "restart-failed",
          complete: false,
          dir,
          rounds,
          error,
        };
    }
  }
  if (
    allPassed &&
    startingRevision === revision &&
    accepted.size === corpus.graphics.length
  ) {
    const finalEvidence = await validateEvidence("full-corpus-" + round, {
      mode: "final",
    });
    if (finalEvidence.pass)
      return {
        verdict: "pass",
        complete: true,
        dir,
        rounds,
        revision,
        graphics: corpus.graphics.length,
        accepted: [...accepted.values()],
        comparisonPolicy,
      };
    return {
      verdict: "reference-corpus-incomplete",
      complete: false,
      dir,
      rounds,
      revision,
      failures: finalEvidence.failures,
    };
  }
}
return {
  verdict: "rounds-exhausted",
  complete: false,
  dir,
  rounds,
  revision,
  openFeedback: Object.fromEntries(feedback),
  reason: "Full corpus must pass at one unchanged API revision.",
};
