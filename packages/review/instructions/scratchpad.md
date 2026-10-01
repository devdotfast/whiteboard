# Scratchpad

The scratchpad is one document in Whiteboard that is not a session for any change. It has no target, base, head or lifecycle. You draw on it the way you would sketch an explanation on a whiteboard: a short paragraph, a sequence or flow diagram, a call tree, a code peek, and the smallest view that makes the point. The user reads it in the app and copies blocks back to you.

Its id is fixed: `scratchpad`. While it is turned on in Whiteboard Settings it always exists; never create, rename, delete, dismiss or share it.

## When to draw here

- The user asks to be shown how something works, wants a picture of a flow, a call path, a data shape or a layout, or is thinking out loud with you before there is a concrete plan.
- The explanation spans more than one file or more than one repository, or would be an ASCII diagram in chat.

Answer in chat when one sentence or one code line does it. Do not use the scratchpad to review a change; author a session instead (`session_get_instructions({})`).

## How

1. `session_capabilities({})`. Draw only when `desktopAvailable` and `scratchpadEnabled` are true. Otherwise answer in chat; if the pad is off, say once that it can be turned on in Whiteboard Settings.
2. Every source reference needs pins. For each repository you will quote, `session_register_repository({path})` for its `repositoryId`, and `git rev-parse HEAD` (or the commit the user is looking at) for a commit id. Put `pins: {repositoryId, head}` on each block that quotes code (`code_peek`, `sequence`, `flow_diagram`, `call_stack_diff`, `database_lens` and `markdown` with `review-source:` links); a step, frame, attachment or operation that quotes other commits than its block takes its own `pins`. Add `base` only when an anchor reads the base side. A reference without pins is rejected, since the scratchpad has none to lend.
3. Read what you cite at those commits, for example `git show <head>:<path>` in the repository, so line numbers match the pins.
4. Call `session_activity_begin` and pass the `activityId` it returns on each `session_edit` as you append blocks. Omitted placement puts the block at the top of the pad, and the response's `targetId` names it. A thought that spans several blocks reads top-down only if you insert it bottom-up (last block first) or give each following block `afterId` of the block you just inserted. Draw a diagram whole in one insert; fix one you drew earlier by patching its nodes, edges or steps by ID, and `replace` a block only when the whole picture was wrong. The block shapes are the same as a session's; follow the edit tool's description for them, and read `session_get_instructions({topic:"authoring"})` for choosing components. End the activity when finished.
5. After your first insert in a session, `session_open({sessionId: "scratchpad"})` once so the pad is showing. Do not call it again for later edits; they appear live.
6. In chat, say in one line what you drew. Do not repeat the diagram there.

Keep it a log, not a document: the newest thought sits at the top, above older ones. Do not build sections, outlines or status markers unless the user asks for structure. When the user asks to clear the pad, `replace` or `remove` its blocks; history keeps what was there.
