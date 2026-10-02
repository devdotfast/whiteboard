import { z } from "zod";

import {
  activityBeginSchema,
  activityEndSchema,
  activityUpdateSchema,
} from "./activity.js";
import { pathTargetSchema, publishedEditSchema } from "./document.js";
import { instructionsQuerySchema } from "./instructions.js";
import { uploadSchema } from "./local-data.js";
import { inspectQuerySchema } from "./read-schemas.js";
import { REVIEW_STATUS_TOOL } from "./status-tool.js";
import { commandSchema } from "./store.js";

/** The host publishes its input schemas, except where agents write less than
 * the host accepts (publishedEditSchema, publishedLensEditSchema) or name a
 * checkout by path (pathTargetSchema); adapters validate nothing. */
export function authoringTools(
  scratchpadAvailable = false,
  traceEnabled = false,
) {
  const id = z.string().min(1);
  const review = { reviewId: id };

  // Anthropic rejects a top-level union, so publish one object; the host validates the union.
  // The map kind is left out: its software-map model schema was most of the
  // catalog's size, and the host still accepts map uploads from other callers.
  const [image, trace] = uploadSchema.options;

  const uploadInput = z
    .strictObject({
      ...image.shape,
      ...trace.shape,
      kind: z.enum(["image", "trace"]),
    })
    .partial()
    .required({ id: true, repositoryId: true, kind: true });

  const descriptions = {
    create:
      'Create a review of saved working files, immutable commits or a GitHub PR. Revisions are resolved on acceptance. A worktree target reviews the saved files in its checkout, uncommitted and untracked ones included, against base: the branch to compare against, by default the default branch of the repository. The diff starts at the merge base of base and HEAD, which follows rebases. Omitted commits base means source at head with no diff; supply the parent to review introduced changes. For a GitHub PR, pullRequestUrl alone is enough: target and title become optional, and the host fetches the PR into a registered checkout of its repository and pins the current PR head and GitHub diff base, titled from the PR. When a review for that PR exists, it is returned instead, reporting whether its head moved and whether an agent is working on it; update it in place, move its target with review_set_target, or create a separate review with reuseExisting. kind:"scratchpad" names the one scratchpad, which the host creates itself. The result carries review, the review as review_list shows it: its target with resolved commits, origin (its PR), repositoryName and repositoryPath, so no follow-up read is needed before diffing. When Desktop is available the review opens there and the result reports opened, softwareMapEnabled and environmentIssues, as review_open does; set open:false to author in the background without taking over Desktop.',
    set_target:
      "Move the review to a new target, such as the commits after a rebase or amend, preserving the document and component IDs. Revisions are resolved on acceptance. Returns warnings for retained source ranges in files the new commits changed, to verify, and resources that no longer match; fix them with review_edit. Earlier versions keep their source. Omitted pullRequestUrl keeps the PR within the same repository; changing repositories clears it. Supply a URL to replace it or null to detach.",
    edit: [
      "Edit one document component. content is one component, named by its type; each type's fields are in the Components section of session_get_instructions (authoring or scratchpad).",
      "Anchors are head/path#L10-L20 or base/path#L7, or diff/path#L84-R90 for a range across sides, with repository-relative paths and 1-based inclusive lines. pins {repositoryId, head, base?} say which commits anchors quote: a step, frame, attachment or operation without pins uses its block's, and a block without them the review's.",
      "insert adds content: parentId nests it, afterId places it, and omitted placement appends (on the scratchpad, it lands at the top). update patches a component's own fields; null removes an optional one. A section's children and a diagram's units change through their own IDs; a call stack's frames change by replacing the call stack. move and remove take a targetId; removing a flow_node removes its edges.",
      "The host assigns short durable IDs. The result names the edited component and, for an insert or replace, its first-level children, and quotes the first and last line of each anchor the edit added or changed (the first 20; unquotedAnchors counts the rest): check they are the lines you meant. Accepted edits save at once.",
      "While a reader may be watching, write small and often: one paragraph per edit. Insert a new diagram whole. Change one already drawn a unit at a time (a flow_node, flow_edge or step, with parentId naming the diagram), and link each added flow_node to a node already drawn.",
    ].join("\n"),
    lens_edit:
      "Edit one Diff-view lens. Lenses partition the review's change for the Diff view; they sit beside the document (never in it) and version with it. The host assigns durable lens IDs; updates replace only the fields supplied. Write one lens per call while a reader may be watching; each draws in on the Diffs page. Pass your activityId so your courier draws each lens. The result identifies the lens and reports uncategorized: changed lines no lens selects yet, grouped by file. Keep adding lenses until it is empty or what remains is deliberate. review_lens_get reads the current lenses and gaps.",
    rename: "Change the review title.",
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
      "Show that you are working on a review: the reader sees your focus and your courier drawing your edits, and the review reads as finished only once every agent has ended. Returns an activityId: pass it to session_edit and session_lens_edit so your courier draws them, and to review_activity_update and review_activity_end. Nothing is locked; other agents can work on the review too. The activity expires after 3 minutes without an edit or update.",
      activityBeginSchema.extend(review),
      "POST",
      "/:reviewId/activity/begin",
    ),
    tool(
      "activity_update",
      "Change your focus, or keep your activity alive during long reads or pauses; an edit carrying your activityId already keeps it alive. Omitted focus preserves it and null clears it. Fails once the activity has expired: begin a new one.",
      activityUpdateSchema.extend(review),
      "POST",
      "/:reviewId/activity/update",
    ),
    tool(
      "activity_end",
      "End your activity when your part is finished: readers treat a review with content and no live activity as ready. Ending it creates no document version. Ending twice, or an expired activity, changes nothing.",
      activityEndSchema.extend(review),
      "POST",
      "/:reviewId/activity/end",
    ),
    ...commandSchema.shape.operation.options.map((operation) => {
      const type = operation.shape.type.value;

      // Agents name a checkout by its path; /commands registers it.
      const {
        type: _type,
        repositoryId: _repositoryId,
        ...fields
      }: Record<string, z.ZodType> = operation.shape;

      return tool(
        type,
        descriptions[type],
        z.strictObject({
          ...fields,
          ...(type === "create" && {
            target: pathTargetSchema.optional(),
            repositoryPath: id
              .optional()
              .describe(
                "Only with pullRequestUrl and no target: the local checkout to fetch the PR into. Default: the existing review's, else the first registered checkout with a remote for the PR's repository.",
              ),
            open: z.boolean().optional(),
          }),
          ...(type === "set_target" && { target: pathTargetSchema }),
          ...(type === "edit" && { edit: publishedEditSchema }),
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
      "Register a local Git or jj repository and return its id, for pins on scratchpad blocks. session_create and session_set_target take the checkout's path instead.",
      z.strictObject({ path: id }),
      "POST",
      "/repositories",
    ),
    tool(
      "upload",
      'Retain an image or trace for use in a review. kind:"image" takes base64; kind:"trace" takes trace. Reusing an upload ID requires identical content; rejected uploads are not saved.',
      uploadInput,
      "POST",
      "/resources",
    ),
  ];
}
