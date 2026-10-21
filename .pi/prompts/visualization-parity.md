---
description: Iterate real MCP recreations of every Cursor Git visualization against visual smoke checks, improving reusable Whiteboard APIs
argument-hint: "[optional additional goals]"
---

Read `.pi/visualization-workflow.md` and `.pi/visualization-rules.md`. Additional user goals:

$@

Use the default blog-inspired animation smoke suite, prioritizing a nice flexible public API, readable text, layout, motion and controls. Exact source poses/data/timing and full simulations are optional. Check the one managed app's readiness and animation authoring capability; report the Experimental Animations prerequisite if disabled. Warm native mcp__whiteboard discovery/status, then invoke `subagent({workflow: ".pi/workflows/visualization-parity.js", args:{task:<additional goals>}, async:true, options:{globalConcurrencyLimit:1,maxSubagentSpawnsPerRun:600}})`. In headless Pi use async:false and add timeoutMs:21600000. Preserve native execution/evidence and wait for an active workflow before continuing. Report visual quality results, API improvements and concrete remaining defects.
