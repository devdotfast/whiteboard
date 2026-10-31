// pi-subagents workflow: plan -> (implement -> restart -> inspect)* until the
// inspector passes or the round budget runs out.
//
//   subagent({ workflow: ".pi/workflows/ui-feature.js", args: { task: "..." }, async: true })
//
// args.task       what to build (required)
// args.maxRounds  implement/restart/inspect rounds, default 4
// args.plan       path of an existing plan to skip planning
//
// Models live in the agent files under .pi/agents/. The app starts only via
// `pnpm dev`, and no step runs tests.
if (!args.task && !args.plan) throw new Error("args.task is required");

const dir = ".pi-subagents/ui-feature";
const maxRounds = args.maxRounds ?? 4;

const restartSchema = {
  type: "object",
  properties: {
    status: { enum: ["ready", "exited", "timeout"] },
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          excerpt: { type: "string" },
        },
        required: ["file", "excerpt"],
        additionalProperties: false,
      },
    },
    noiseLines: { type: "integer" },
    summary: { type: "string" },
  },
  required: ["status", "errors", "summary"],
  additionalProperties: false,
};

const inspectSchema = {
  type: "object",
  properties: {
    verdict: { enum: ["pass", "fail"] },
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rule: { type: "string" },
          result: { enum: ["pass", "fail", "not-reachable"] },
          screenshots: { type: "array", items: { type: "string" } },
        },
        required: ["rule", "result", "screenshots"],
        additionalProperties: false,
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          severity: { enum: ["blocker", "major", "minor"] },
          rule: { type: "string" },
          screenshots: { type: "array", items: { type: "string" } },
          region: { type: "string" },
          observed: { type: "string" },
          expected: { type: "string" },
        },
        required: ["id", "severity", "rule", "screenshots", "region", "observed", "expected"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "rules", "findings"],
  additionalProperties: false,
};

let planPath = args.plan;
if (!planPath) {
  planPath = dir + "/plan.md";
  const plan = await runs.run("plan", {
    label: "Plan the UI change",
    agent: "ui-planner",
    task: ["Plan this change to the canvas UI:", "", args.task].join("\n"),
    output: planPath,
  });
  if (!plan.ok) return { verdict: "plan-failed", planPath, error: plan.error };
}

const rounds = [];
let feedback = null;

for (let round = 1; round <= maxRounds; round++) {
  const implement = await runs.run("implement-" + round, {
    label: "Implement round " + round,
    agent: "ui-implementer",
    task: [
      "Implement the plan in " + planPath + ".",
      "Original request: " + (args.task ?? "see plan"),
      feedback ? "\nThis is round " + round + ". Fix these first:\n" + feedback : "",
    ].join("\n"),
  });
  if (!implement.ok) {
    rounds.push({ round, step: "implement", error: implement.error });
    return { verdict: "implement-failed", planPath, rounds };
  }

  const restart = await runs.run("restart-" + round, {
    label: "Restart Desktop round " + round,
    agent: "desktop-restarter",
    task: "Restart the Desktop for round " + round + " and report what the logs say.",
    outputSchema: restartSchema,
    output: dir + "/restart-" + round + ".json",
  });
  const boot = restart.structuredOutput;
  if (!boot || boot.status !== "ready" || boot.errors.length) {
    rounds.push({ round, step: "restart", boot: boot ?? restart.error });
    feedback = [
      "The Desktop did not come up cleanly after your change (status: " +
        (boot ? boot.status : "unknown") + ").",
      JSON.stringify(boot ?? { error: restart.error }, null, 2),
    ].join("\n");
    continue;
  }

  const inspect = await runs.run("inspect-" + round, {
    label: "Inspect UI round " + round,
    agent: "ui-inspector",
    task: [
      "Inspect the running Desktop for round " + round + ".",
      "Plan (How to reach it, States, Feature rules): " + planPath,
      "General rules: .pi/ui-rules.md",
      "Name screenshots with the prefix r" + round + "- so rounds do not overwrite each other.",
    ].join("\n"),
    outputSchema: inspectSchema,
    output: dir + "/inspect-" + round + ".json",
  });
  const report = inspect.structuredOutput;
  if (!report) {
    rounds.push({ round, step: "inspect", error: inspect.error });
    return { verdict: "inspect-failed", planPath, rounds };
  }
  rounds.push({
    round,
    verdict: report.verdict,
    findings: report.findings.length,
    report: dir + "/inspect-" + round + ".json",
  });
  if (report.verdict === "pass") return { verdict: "pass", planPath, rounds };

  feedback = [
    "UI inspector findings (screenshots are PNGs you can read):",
    JSON.stringify(report.findings, null, 2),
  ].join("\n");
}

return { verdict: "rounds-exhausted", planPath, rounds, openFeedback: feedback };
