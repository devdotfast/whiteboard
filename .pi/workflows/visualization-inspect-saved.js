// Re-inspect a frozen, complete capture matrix without touching Desktop or boards.
// Inputs are prepared by the capture owner; native receipts remain independently validated.
if (typeof args.root !== "string" || !args.root.startsWith(".pi-subagents/visualization-parity/"))
  throw new Error("root must be a visualization run directory");
if (!Array.isArray(args.graphics) || !args.graphics.length || args.graphics.some((id) => typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)))
  throw new Error("graphics must name the selected manifest ids");
const results = [];
for (const id of args.graphics) {
  const inspected = await runs.run("inspect-saved-" + id, {
    agent: "viz-inspector",
    label: "Review saved source/app matrix: " + id,
    task: [
      "Review only graphic " + id + ". This is a frozen-evidence inspection, not a capture or authoring run.",
      "The capture owner already verified current live payload identity and captured the complete post-mutation matrix. Read " + args.root + "/reports/" + id + "/inputs.json for the exact source PNG, actual responsive source PNG, actual app PNG, full raw diagnostic, native audit, and real interaction evidence for EVERY required capture. Use the exact screenshot and diagnostics paths from inputs.json in the report. Do not copy/rebase app captures or raw diagnostics: the shared run root is the containment boundary, not this report folder. Do not change PNGs, raw shot objects, source cache, or other graphics.",
      "Read " + args.root + "/review-notes.md as review context, then verify against the actual PNGs and source metadata yourself. Read each required app PNG and corresponding source PNG at readable size, including every state/theme/viewport/motion combination. Use real source relationships, not just identifier/edge counts. Follow the supplied comparisonPolicy. Inspired policy uses the source as inspiration: simplification and different data/timing are allowed; prioritize app readability, layout, motion, controls and API ergonomics. Canonical/exact policies apply only when explicitly requested.",
      "Use only file reading/inspection and artifact writes via bash. NO Desktop helper, MCP, browser, app lifecycle, tests, source edits, or new agent. Existing interaction evidence explicitly names its tested variant. Do not claim an unperformed exact-variant action; the current capture itself verifies actual keyboard frame selection in each variant. Inspect the supplementary raw control and scroll evidence where provided.",
      "Write exactly " + args.root + "/reports/" + id + "/report.json matching .pi/visualization-report.schema.json. Enumerate every capture x required rule, cite that PNG and diagnostic in every visual row and concrete observed facts. Interaction rows also cite actual interaction artifacts inside the run root. Unknown, stale, contradictory, missing or defective evidence must fail, not become an assumed pass. Do not repeat measurements or checks not present in the evidence. Note intentional scroll/hidden-accessibility clipping only after reviewing the reachability/paint evidence.",
      "A new feature flag disables authoring by default but never rendering; captures and reads remain possible while off. Do not enable it or attempt edits. Captures postdate final native mutation; validator checks this independently.",
      "Return the report path, verdict, and concrete unresolved findings. Keep reports and observations concise but complete.",
    ].join("\n"),
  });
  results.push({ graphicId: id, ok: inspected.ok, output: inspected.output, error: inspected.error });
}
return { results };
