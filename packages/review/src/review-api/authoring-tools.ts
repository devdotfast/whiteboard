import { z } from "zod";

import {
  activityBeginSchema,
  activityEndSchema,
  activityUpdateSchema,
} from "./activity.js";
import { fileLineRangeSchema, publishedEditSchema } from "./document.js";
import { instructionsQuerySchema } from "./instructions.js";
import { uploadSchema } from "./local-data.js";
import { inspectQuerySchema, readQuerySchemas } from "./read-schemas.js";
import { REVIEW_STATUS_TOOL } from "./status-tool.js";
import { commandSchema } from "./store.js";

/** The host publishes its input schemas, except session_edit's, which shows
 * less than the host accepts (publishedEditSchema); adapters validate
 * nothing. */
export function authoringTools(
  scratchpadAvailable = false,
  traceEnabled = false,
) {
  const id = z.string().min(1);
  const review = { reviewId: id };
  const version = z.number().int().nonnegative().optional();

  // Anthropic rejects a top-level union, so publish one object; the host validates the union.
  const [image, trace] = uploadSchema.options;

  const uploadInput = z
    .strictObject({
      ...image.shape,
      ...trace.shape,
      kind: z.enum(["image", "trace"]),
    })
    .partial()
    .required({ id: true, repositoryId: true, kind: true });

  const read = (name: keyof typeof readQuerySchemas) =>
    z.strictObject({ ...review, ...readQuerySchemas[name].shape });

  const descriptions = {
    create:
      'Create a review of saved working files, immutable commits or a GitHub PR. Revisions are resolved on acceptance. A worktree target reviews the saved files in its checkout, uncommitted ones included and untracked ones left out (git add -N a new file to include it), against base: the branch to compare against, by default the default branch of the repository. The diff starts at the merge base of base and HEAD, which follows rebases. Omitted commits base means source at head with no diff; supply the parent to review introduced changes. For a GitHub PR, pullRequestUrl alone is enough: target and title become optional, and the host fetches the PR into a registered checkout of its repository and pins the current PR head and GitHub diff base, titled from the PR. When a review for that PR exists, it is returned instead, reporting whether its head moved and the id of any live lease on it; update it in place, move its target with review_set_target, or create a separate review with reuseExisting. kind:"scratchpad" names the one scratchpad, which the host creates itself. The result carries review, the review as review_list shows it: its target with resolved commits, origin (its PR), repositoryName and repositoryPath, so no follow-up read is needed before diffing. When Desktop is available the review opens there and the result reports opened, softwareMapEnabled and environmentIssues, as review_open does; set open:false to author in the background without taking over Desktop.',
    set_target:
      "Change the review target, preserving document and component IDs. Returns warnings for source references needing repair. Earlier versions keep their retained source.",
    edit: [
      "Edit a document component. content is one component, named by type. Its fields, with ? for optional and anchor for a source anchor string:",
      "markdown {markdown, pins?}",
      "code {text, language?, caption?}",
      "divider {}",
      "code_peek {source: anchor, caption?, pins?}",
      "section {title, children: component[], defaultCollapsed?}",
      "callout {children: component[], title?, tone?: info|warning|danger|success}",
      "image {assetId from review_upload, alt, caption?}",
      "trace_quote {traceId, eventId, text}",
      "software_map {mapVersionId, focusElementId?}",
      "sequence {title, actors: {key: label}, steps: step[], pins?}",
      "step {from, to (actor keys), label, style?: call|return|async, and exactly one of source: anchor, explanation, or code: {text, language?}; pins?}",
      "flow_diagram {title, nodes: flow_node[] (1 to 100), edges: flow_edge[], description?, direction?: right|down, pins?}",
      "flow_node {key, label, description?, kind?: process|decision|terminal, attachments?: {label, sources: anchor[], pins?}[], link?: {from or to, label?, style?}}",
      "flow_edge {from, to (node keys), label?, style?: solid|dashed}",
      "call_stack_diff {title, base: frame[], head: frame[], pins?}; either side may be empty",
      "frame {source: anchor, label?, key?, parentKey? (an earlier frame on that side), callSite?: anchor, contextSources?: anchor[], via?: {kind: call|queue|callback|rpc, reason}, pins?}",
      "database_lens {title, actors: {key: label}, stores: {key: store}, useCases: useCase[] (1 or more), pins?}",
      "store {label, storage: relational|document, collections: {key: {label, fields: {key: field}}}, dataStoreKind?: database|objectStore|bucket|artifactStore|fileStore}",
      "field {label, dataType, nullable?, primaryKey?, references?: {store, collection, field}, fields?: {key: field}}",
      "useCase {label, summary?, operations: operation[] (1 or more)}; operation {kind: read|write, actor, store, collection, label, source: anchor, field?, detail?, pins?}, naming declared keys",
      "Anchors are head/path#L10-L20 or base/path#L7, or diff/path#L84-R90 for a range across sides, with repository-relative paths and 1-based inclusive lines. pins {repositoryId, head, base?} say which commits anchors quote: a step, frame, attachment or operation without pins uses its block's, and a block without them the review's.",
      'Example: {"type":"sequence","title":"Request","actors":{"a":"Client","b":"Server"},"steps":[{"from":"a","to":"b","label":"Send","source":"head/src/app.ts#L10-L20"}]}',
      "Replace example paths and lines with verified source ranges. The host assigns short durable IDs; use returned IDs to edit components in place. The result identifies the edited component and, for an insert or replace, its first-level children, so they can be edited without a follow-up read. Accepted edits are saved immediately. Omitted placement appends; on the scratchpad it lands at the top, so insert a multi-block thought bottom-up or chain each block with afterId. To fill a section later, insert into it with parentId. null removes an optional field in a patch. While a reader may be watching, write small and often: one paragraph per edit, so the document draws itself as you go. Insert a new diagram whole, with all its nodes and edges or steps; the board traces it in one quick pass. Change a diagram already on the board one unit at a time: insert, update or remove a flow_node, flow_edge or step by ID (parentId names the diagram). Link each added flow_node to a node already drawn, so it arrives attached; a separate flow_edge is only for two nodes that already exist. Removing a flow_node removes its edges.",
    ].join("\n"),
    lens_edit:
      'Edit one Diff-view lens. Lenses partition the review\'s change for the Diff view; they sit beside the document (never in it) and version with it. The host assigns durable lens IDs; updates replace only the fields supplied. Write one lens per call while a reader may be watching; each draws in on the Diffs page. Requires the lenses lease: review_activity_begin with scope:"lenses", which another agent can hold while the document lease is held elsewhere. The result identifies the lens and reports uncategorized: changed lines no lens selects yet, grouped by file. Keep adding lenses until it is empty or what remains is deliberate. review_lens_get reads the current lenses and gaps.',
    rename: "Change the review title.",
    repin:
      "Update source pins or PR identity while preserving the document and component IDs. Returns warnings for retained source ranges to verify and resources that no longer match; fix them with review_edit. Previous pins and content remain in history. Omitted pullRequestUrl preserves PR identity within the same repository; changing repositories clears it. Supply a URL to replace it or null to detach.",
    restore:
      "Restore title, source pins, PR identity and content from a saved version.",
    attention:
      "Mark a review viewed, dismissed or restored without changing its content.",
    delete: "Permanently delete this review and its history.",
  };

  const tool = (
    name: string,
    description: string,
    schema: z.ZodType,
    method: "GET" | "POST",
    path: string,
    commandType?: string,
  ) => ({
    name: `review_${name}`,
    description,
    inputSchema: {
      ...z.toJSONSchema(schema, { io: "input" }),
      type: "object" as const,
    },
    method,
    path,
    commandType,
  });

  return [
    REVIEW_STATUS_TOOL,
    tool(
      "capabilities",
      "Discover whether Desktop is available and optional software-map generation is enabled. Read before authoring.",
      z.strictObject({}),
      "GET",
      "/capabilities",
    ),
    tool(
      "get_instructions",
      'Read Whiteboard\'s guidance before creating or editing a review. The default topic gives the authoring workflow; "file-lenses" covers Diff-view file lenses.' +
        (traceEnabled
          ? ' Call review_get_instructions({topic:"trace-archaeology"}) for why code exists, what an agent was thinking, or whether an agent solved this before.'
          : "") +
        (scratchpadAvailable
          ? ' When the user asks in conversation to be shown how code works or wants a diagram, without asking for a review, draw it on the scratchpad rather than answering only in chat: call review_get_instructions({topic:"scratchpad"}) first. A request for a review or to use Whiteboard means authoring a review with the default topic.'
          : ""),
      instructionsQuerySchema.partial(),
      "GET",
      "/instructions",
    ),
    tool(
      "activity_begin",
      "Acquire an exclusive authoring session for one scope of a review and return its leaseId: pass it on every write in that scope, to review_activity_update and to review_activity_end. Separate scopes let one agent author lenses while another holds the document lease. Each scope has its own lease and focus; a focus targetId in the lenses scope names a lens id. The lease expires after 3 minutes without an accepted write or update. Another session gets a conflict while this lease is active. Use focus to show current work.",
      activityBeginSchema.extend(review),
      "POST",
      "/:reviewId/activity/begin",
    ),
    tool(
      "activity_update",
      "Keep an authoring session alive and change its focus. Each accepted write carrying the leaseId already keeps it alive; call this during long reads or pauses between edits, or to show new work. Omitted focus preserves it and null clears it. Fails once the lease has expired: begin a new session and reread the review before editing.",
      activityUpdateSchema.extend(review),
      "POST",
      "/:reviewId/activity/update",
    ),
    tool(
      "activity_end",
      "End an authoring session only when the review is finished: readers treat a review with content and no live session as ready. Ending it creates no document version. Ending an expired lease, or another session's, changes nothing.",
      activityEndSchema.extend(review),
      "POST",
      "/:reviewId/activity/end",
    ),
    ...commandSchema.shape.operation.options.map((operation) => {
      const type = operation.shape.type.value;
      const { type: _type, ...fields } = operation.shape;

      return tool(
        type,
        descriptions[type],
        z.strictObject({
          ...fields,
          ...(type === "create" && { open: z.boolean().optional() }),
          ...(type === "edit" && { edit: publishedEditSchema }),
          commandId: z
            .uuid()
            .optional()
            .describe(
              "Idempotency key. Omit it; Whiteboard assigns one. Pass one only when an error tells you to.",
            ),
          ...(type !== "create" &&
            type !== "attention" && {
              leaseId: commandSchema.shape.leaseId.describe(
                'The leaseId from review_activity_begin, if you hold a lease on this review (scope "lenses" for review_lens_edit).',
              ),
            }),
        }),
        "POST",
        "/commands",
        type,
      );
    }),
    tool("list", "List saved reviews.", z.strictObject({}), "GET", ""),
    tool(
      "get",
      "Read a readable, nested text outline with editable IDs. targetId reads one component in full; full:true reads all content. Use format:json for raw node data or snapshots instead of text.",
      z.strictObject({ ...review, ...inspectQuerySchema.shape }),
      "GET",
      "/:reviewId/inspect",
    ),
    tool(
      "lens_get",
      "Read the review's Diff-view lenses as authored (ids, titles, targets), each lens's resolved fileCount (and unavailable reason, if any), and uncategorized: the changed lines no lens selects yet, by file.",
      z.strictObject(review),
      "GET",
      "/:reviewId/lenses",
    ),
    tool(
      "history",
      "List saved document versions.",
      z.strictObject(review),
      "GET",
      "/:reviewId/history",
    ),
    tool(
      "open",
      "Show an existing review immediately and prepare current pinned checkouts in the background. Returns softwareMapEnabled and any already-recorded environmentIssues. Missing optional setup is not an issue; use review_environment to recheck.",
      z.strictObject(review),
      "POST",
      "/:reviewId/open",
    ),
    tool(
      "environment",
      "Acquire and recheck this review's current base/head language checkouts (not historical or selected commits). Returns acquisition issues, not full LSP health. Missing optional setup and failed setup with a usable checkout stay silent. Set retry:true to rerun failed preparation after an actual language-feature failure; preparation runs in the background.",
      z.strictObject({ ...review, retry: z.boolean().optional() }),
      "POST",
      "/:reviewId/environment",
    ),
    tool(
      "workspace_cleanup",
      "Inspect failed cleanup of retired review-owned checkouts. Supply workspaceId to retry removal of that checkout. This does not remove active review checkouts.",
      z.strictObject({ workspaceId: id.optional() }),
      "POST",
      "/workspace-cleanup",
    ),
    tool(
      "register_repository",
      "Register a local Git or jj repository. The prepared checkout path is on the authoring server.",
      z.strictObject({ path: id }),
      "POST",
      "/repositories",
    ),
    tool(
      "resolve_pins",
      "Resolve base and head revisions to immutable commit IDs for create or repin.",
      z.strictObject({ repositoryId: id, base: id, head: id }),
      "POST",
      "/pins",
    ),
    tool(
      "upload",
      'Retain an image or trace for use in a review. kind:"image" takes base64; kind:"trace" takes trace. Reusing an upload ID requires identical content; rejected uploads are not saved.',
      uploadInput,
      "POST",
      "/resources",
    ),
    tool(
      "source",
      "Read an exact code range from the current target. An explicit version reads retained historical source. source.pins reads at explicit commits of any registered repository instead; the same pins on a block, or on the step, frame, attachment or operation holding an anchor, make it resolve there.",
      z.strictObject({
        ...review,
        version,
        source: fileLineRangeSchema,
        commit: z.string().min(1).optional(),
      }),
      "POST",
      "/:reviewId/source",
    ),
    tool(
      "file",
      "Read a complete source file from the current target; version selects retained history. repositoryId and head (and base for the base side) read at explicit pins of any registered repository instead.",
      read("file"),
      "GET",
      "/:reviewId/file",
    ),
    tool(
      "tree",
      "List immediate directory entries in the target, including working files for worktree targets. repositoryId and head list a registered repository at explicit pins instead.",
      read("tree"),
      "GET",
      "/:reviewId/tree",
    ),
    tool(
      "diff",
      'Read this review\'s changes. paths selects files (default: all). format:"files" lists them with status and counts; format:"patch" returns plain-text patches with base and head line numbers on every line, ready for review-source links. Patches past maxBytes are listed with a paths:[…] hint. commit selects one commit from this review; repositoryId, base and head compare explicit pins of a registered repository instead.',
      read("diff"),
      "GET",
      "/:reviewId/diff",
    ),
    tool(
      "commits",
      "List commits in this review's pinned comparison.",
      read("commits"),
      "GET",
      "/:reviewId/commits",
    ),
  ];
}
