---
name: whiteboard
description: "Explain code in Whiteboard, the architecture-visualization tool: author plans and linked reviews of branches, changes and pull request stacks, or research why code exists from past agent sessions."
---

# dev.fast Whiteboard

If `mcp__whiteboard__*` tools are available, use them instead of this skill.

Whiteboard serves its own instructions. Before authoring, run `whiteboard api session_get_instructions '{}'` and follow the result. Pass `'{"topic":"trace-archaeology"}'` to research why code exists. If Whiteboard is not running, the response says how to start it.
