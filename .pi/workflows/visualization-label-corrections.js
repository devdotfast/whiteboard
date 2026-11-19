return await runs.run("correct-source-labels", {
  agent: "viz-author",
  label: "Correct known unfetched names and upload status",
  task: [
    "MCP CORRECTIONS ONLY: use native MCP, no product edits, screenshots, app lifecycle, or other agents. Root's source-label comparison established exactly two missing/wrong labels. Preserve all other payload content.",
    "KV board21acd381-fc3e-47a3-b90f-7e08ca1b054e: the fetched root tree already reveals blob filenames even before the blobs return. Current node helper has n.append(el('b','',returned?title:'?'),el('small','',meta)); replace only returned?title:'?' with (returned||kind==='blob')?title:'?' in that exact helper. Keep dashed ghost styling and unknown COMMIT question marks. SERVER.TS, PACK.TS, README.MD and CARGO.TOML must remain named in the reading state.",
    "WAL push board408b49d0-b990-4777-b4a6-c38342d25df5: replace only the status span text <span class='status only-status upload'>UPDATING</span> with <span class='status only-status upload'>UPLOADING</span>. The source phase uploads the immutable WAL object, before publishing the index.",
    "For each: session_get block-1 JSON; verify exact expected fragment; activity_begin, session_edit update changes:{html}, activity_end, session_get JSON and session_open. Chain actual returned values in codemode to avoid recopying HTML. Discover actual schema. Any missing fragment or failed call stops with an honest failure.",
    "Write fresh transport:mcp traces at .pi-subagents/visualization-parity/consolidated-repair/label-corrections/<graphicId>/author/trace.json with boardId,graphicId,createdAt,comparisonPolicy:canonical,blockId:block-1,states:{key,navigation} and limitations. Return actual results and trace paths only.",
  ].join("\n"),
});
