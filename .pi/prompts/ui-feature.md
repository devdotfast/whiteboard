---
description: Plan, implement, restart and visually verify a canvas UI change
argument-hint: "<what to build>"
---
Run the ui-feature workflow for this request:

$@

Call `subagent({ workflow: ".pi/workflows/ui-feature.js", args: { task: <the request above, verbatim> }, async: true })`.
Do not do any of the steps yourself. When it finishes, report the verdict, the
rounds it took, the open findings if any, and the plan path. If a step stops on
a `need_decision` from the implementer, bring the question to me.
