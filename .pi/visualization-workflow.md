# Animation API workflow

Build eleven varied examples inspired by Cursor's Git blog, using the public Whiteboard MCP API. The user clarified that readable, attractive animations and a flexible API matter more than exact reproduction. `.pi/visualizations/animation-smoke.json` defines two representative states per animated example, the two charts, and light/wide, dark/narrow and reduced-motion captures:60 screenshots plus actual behavior evidence. Read `.pi/visualization-rules.md` for quality criteria.

## Run

Check the sole managed app with `node .pi/tools/desktop.mjs status`. Use its guarded restart only when needed; it owns process identity, cross-checkout locking and the MCP port. Read `session_capabilities`; authoring needs Settings > Experimental Features > Animations. Rendering/reads continue while disabled. Warm native `mcp__whiteboard` discovery/status in the Pi parent, then invoke `/visualization-parity`. Headless `pi --approve` loads project MCP configuration; dispatch the workflow with async:false and options `{globalConcurrencyLimit:1,timeoutMs:21600000}`. Run one workflow at a time.

The workflow defaults to the smoke manifest and comparisonPolicy `inspired`. Use existing cached reference images for ideas; no new source capture is needed to match incidental poses. Legacy `canonical`/`exact` modes and `.pi/visualizations/cursor-git.json` remain opt-in for stricter research, with separate fresh acceptance. Historical strict failures are not automatically failures of the current user objective.

## Iterate

Author through MCP, keep native receipts, read back/open the actual board, then inspect the running app. Prefer documented scene/layout/motion primitives and record authoring friction. Use ordinary HTML/CSS when helpful. Simplify example data and model depth rather than overbuilding simulations. Correct payload mistakes; improve shared APIs when correct use reveals general sizing, routing, clipping, lifecycle or ergonomic problems. Recheck affected examples after implementation changes. `.pi`-only workflow changes need no Desktop rebuild.

`visualization-evidence.js` supports read, unchanged-payload roundtrip and explicitly scoped patches on existing boards. Fresh native traces accompany mutations. `capture-viz-corpus.mjs --boards <pairs.json> --output <fresh .pi-subagents directory>` captures the smoke catalog by default; `--manifest` selects another catalog. Its output is evidence, not automatic acceptance. `visualization-inspect-saved.js` reviews frozen captures sequentially without touching the app. The strict evidence validator preserves real receipt, identity, timestamp, PNG/hash and capture-rule coverage checks; inspired policy relaxes source resemblance, not evidence integrity.

## Evidence

Keep original PNGs, raw diagnostics, native receipts and reports inside a run root. Inspect representative motion, controls, replay/back/jump, focus and scroll reachability in addition to screenshots. `.pi/visualization-report.schema.json` defines reports; every required capture/rule has concrete observations. Additional genuine authored frames are allowed. Do not use Preview/computer use or launch another Whiteboard instance. Product code remains independent of the blog. Workflow agents leave automated tests to the primary and ask before editing README.md.

Report which examples pass visual smoke, concrete unresolved defects, reusable API improvements and authoring friction. Exact source-pose parity and full source simulations are outside default completion. Do not call the overall goal complete while actual quality checks or required API fixes remain unverified.
