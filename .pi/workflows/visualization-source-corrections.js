return await runs.run("correct-source-semantics", {
  agent: "viz-author",
  label: "Correct two source fidelity findings",
  task: [
    "MCP CORRECTION ONLY. Read .pi-subagents/visualization-parity/consolidated-repair/source-corrections/transform.js and the board pairs in .pi-subagents/visualization-parity/consolidated-repair/board-pairs.json.",
    "For ONLY spokes-replication and wal-compaction, use native MCP session_get block-1 JSON; apply the exact pure transform function to that current returned node inside codemode; activity_begin, session_edit update changes returned by transform, activity_end, session_get JSON and session_open. These are approved source corrections. Do not change any other board or source file. No screenshot or app lifecycle work.",
    "Discover actual MCP tool schemas first. Chain actual MCP results into transform and edit rather than copying full HTML through model text. Never use shell SDK or persisted board files. Stop and report if an expected fragment is absent or any MCP call fails.",
    "For each graphic, write a fresh transport:mcp trace under .pi-subagents/visualization-parity/consolidated-repair/source-corrections/<graphicId>/author/trace.json with exactgraphicId, boardId, createdAt, comparisonPolicy:canonical, blockId:block-1, states:{key,navigation} from manifest and actual control labels, and limitations. Record source findings: default/progress PACK labels versus unlabeled entering bars; committed small packs left of compaction frontier and per-state medium-tier heights. Return both trace paths and actual results. No other visual/full-matrix workflow or further agent.",
  ].join("\n"),
});
