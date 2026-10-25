---
name: viz-evidence-validator
description: Deterministically validates visualization inventory and on-disk MCP/screenshot evidence
runner:
  type: external-cli
  command: node
  args: [.pi/tools/validate-viz-evidence.mjs]
  promptDelivery: stdin
async: true
systemPromptMode: replace
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
---

Validate the JSON enclosed by viz-validation-json protocol markers. Emit only the command's JSON result.
