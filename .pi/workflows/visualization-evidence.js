// Native MCP evidence pass on existing boards. Read-only by default; an explicit
// roundtrip re-submits the current payload and records a clean author attempt.
if (typeof args.boards !== "string" || !args.boards)
  throw new Error("boards must name the saved graphicId/boardId pairs");
const mode = args.mode ?? "read";
const comparisonPolicy = args.comparisonPolicy ?? "inspired";
if (!["inspired", "canonical", "exact"].includes(comparisonPolicy))
  throw new Error("Unknown comparison policy");
if (!["read", "roundtrip", "patch"].includes(mode)) throw new Error("Unknown evidence mode");
if (mode !== "read" && (typeof args.output !== "string" || !args.output))
  throw new Error("mutation modes require a fresh output root");
if (mode === "patch" && (typeof args.correction !== "string" || !args.correction.trim()))
  throw new Error("patch requires explicit correction instructions");
return await runs.run("verify-current-boards", {
  agent: "viz-author",
  label: mode === "read" ? "Verify current boards through MCP" : mode === "patch" ? "Apply approved MCP correction" : "Clean native MCP roundtrip",
  task: [
    "This is an evidence pass over existing boards, not scene design. No product edits, screenshots, app lifecycle, or other agents.",
    mode === "read" ? "Read-only get/open is allowed when animationsEnabled is false; do not treat disabled authoring as a read blocker." : "Check session_capabilities before mutation. If animationsEnabled is false, return blocked immediately with the Settings prerequisite; do not call contact_supervisor and wait for a headless parent.",
    "Read the graphicId/boardId pairs at " + args.boards + ". Use boardId strings exactly from this parsed file; never infer IDs from prose.",
    "Graphic selection: " + JSON.stringify(args.graphics ?? "all") + ". Ignore unselected pairs.",
    mode === "patch"
      ? "For each selected pair, session_get block-1 JSON, apply ONLY this explicit approved correction: " + args.correction + ". Then activity_begin, session_edit update only changed fields, activity_end, session_get readback, session_open. Discover actual schema. Stop on a missing fragment or failed call, without speculative retries."
      : mode === "read"
      ? "Use native MCP session_get targetId block-1 format json, then session_open for each board. This mode is READ ONLY. Return concise verified ids and failed calls."
      : "For each pair sequentially use native MCP session_get block-1 JSON; activity_begin; session_edit update that same block changes:{html:current.html,frames:current.frames}; activity_end; session_get JSON; session_open. Chain actual returned values inside codemode; do not copy HTML through model text. Re-submit the live payload exactly. Verify html/frames readback equality and actual successful open. Discover current schemas before calls. A failed call stops the attempt, with an honest failure.",
    mode !== "read"
      ? "Write a fresh transport:mcp trace for each graphic at " + args.output + "/<graphicId>/author/trace.json including boardId,graphicId,createdAt,comparisonPolicy:" + comparisonPolicy + ",blockId:block-1,states:{key,navigation} from actual current frames and manifest,limitations. Return trace paths and actual results."
      : "Full native requests/results are recorded by the workflow runtime; do not reproduce payloads in the summary.",
    "Never create boards, use shell SDK/HTTP, or mutate persisted board files. Preserve every existing visual correction. Stop on failure; no speculative retries.",
  ].join("\n"),
});
