# Animation API visual smoke

The user clarified the objective: a nice, flexible API for making animations that look good, especially readable text without overlap or clipping. The blog supplies eleven varied examples. Exact source pixels, object IDs, counters, byte ranges, timing and complete distributed-system simulations are optional. A smaller coherent example can pass. Use `.pi/visualizations/animation-smoke.json` by default. The original `cursor-git.json` remains available for explicitly requested strict comparisons.

## Loop

1. Read public MCP instructions/schemas and the example's reference images. Prefer `whiteboard.scene` and documented layout/motion helpers. Choose a clear small representation of the idea, adapting the design to Whiteboard.
2. Author through native MCP, save the board, read it back and open it in the sole running Desktop. Keep native request/result receipts and a concise trace with graphicId, boardId, timestamp, comparisonPolicy and state navigation. Record API friction: confusing schemas, excessive boilerplate, repeated coordinate tuning, missing composable helpers or ordinary HTML/CSS escape hatches.
3. Inspect the actual example at the manifest's wide/light, narrow/dark and reduced-motion settings. Read PNGs as well as diagnostics. Capture before/mid/after meaningful motion and exercise the visible controls, back/jump/replay and keyboard focus. Source images establish the idea; app evidence establishes quality.
4. Correct payload mistakes through MCP. Improve reusable APIs when correct documented use exposes clipping, routing, sizing, lifecycle or repeated authoring friction. Recheck affected examples after a shared change. Retain unaffected evidence after an authored-content change.

## Checks

- `concept-clear`: the example communicates the intended relationship/process. Simplification and original labels/data are welcome; its own captions, connections and state must agree.
- `text-visible`: all displayed labels and code peeks are readable at normal capture scale, with sensible wrapping and font sizes.
- `text-not-overlapping`: text avoids other text, nodes, packets, arrows, controls and code peeks in settled and representative moving states. Intentional containment is fine.
- `container-padding`: enclosed text follows the public animation guide’s “Text inside shapes” inset requirement. Measure the full rendered text bounds against the actual container boundary, including curved borders, at the displayed size; text can fail this check even without overlap or clipping.
- `content-not-clipped`: stage auto-sizing includes its content and code peeks. Text/controls remain reachable; intentional scroll containers have actual top/bottom reachability evidence. Distinguish a viewport crop from internal clipping. Avoid stale blank space.
- `connections-clear`: real endpoint-bound edges follow the intended nodes, with clear direction and readable labels. Decorative shapes need no artificial edges.
- `controls-work`: displayed controls have meaningful predictable effects. Include cancellation and replay; remove unnecessary controls rather than creating a large simulation to justify them.
- `responsive-layout`: wide and narrow content remains clear with wrapping, reflow or intentional reachable scrolling. No accidental horizontal page overflow.
- `theme-contrast`: text and meaningful UI remain distinguishable in light/dark. Normal text should reach4.5:1 contrast, large text and meaningful boundaries3:1. Resolve diagnostic candidates against actual paint.
- `keyboard-access`: visible controls support keyboard activation and visible focus without moving unrelated workbench content.
- `reduced-motion`: preserve the explanation and controls in a coherent static/settled view, with no required information available only during motion.
- `no-console-errors`: no broken animation, error banner, unhandled exception, missing resource or CSP failure.
- `mcp-only-authoring`: the attempt actually used the public MCP API; a screenshot/video/embed of the source is not an authored animation.
- `authoring-ergonomics`: record which public primitives worked and concrete friction/workarounds. Ordinary HTML/CSS is allowed, and boilerplate is evidence for improvement rather than a forbidden escape hatch. Report whether an agent could make a good result without repeated hidden coordinate fixes. Tie API changes to an observed problem.
- `meaningful-motion`: show a readable transition or data/message movement and a coherent state change. A bounded illustrative sequence is sufficient; full source history, every protocol phase, exact timings and a continuously running simulator are unnecessary.

For every required capture/rule report concrete observations and original app PNG/diagnostic paths using `.pi/visualization-report.schema.json`. Keep raw evidence in place. Diagnose geometry candidates visually; intentional scroll/hidden accessibility content is not automatically a defect. Missing actual behavior evidence stays unknown/incomplete. A source mismatch alone is not a failure under `inspired` policy.

## Boundaries

One workflow owns the app at a time. Only `.pi/tools/desktop.mjs` manages its single instance and MCP port; inspect with its helper and MCP, without Preview or computer use. Check session_capabilities before mutation. When animation authoring is disabled, return the Experimental Animations prerequisite immediately; saved rendering/reads remain available. Keep product code independent of blog-specific selectors, IDs and layouts. Authors do not edit product code or persisted board data; API improvers own implementation. Preserve failed attempts and source assets. Ask before editing README.md. Workflow agents use visual smoke/static checks and leave automated test files to the primary.

For explicitly requested `canonical` or `exact` runs using the original catalog, preserve that run's requested source facts. These legacy comparison modes do not override the user's current default of flexible, blog-inspired examples.
