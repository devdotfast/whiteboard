import { type JsonValue, isJsonObject } from "@dev.fast/json";
import { z } from "zod";

import {
  activityBeginSchema,
  activityEndSchema,
  activityUpdateSchema,
} from "./activity.js";
import { pathTargetSchema, publishedEdits } from "./document.js";
import { instructionsQuerySchema } from "./instructions.js";
import { uploadSchema } from "./local-data.js";
import { inspectQuerySchema } from "./read-schemas.js";
import { REVIEW_STATUS_TOOL } from "./status-tool.js";
import { commandSchema } from "./store.js";

/** The host publishes its input schemas, except where agents write less than
 * the host accepts (publishedEdits, publishedLensEditSchema) or name a
 * checkout by path (pathTargetSchema); adapters validate nothing. */
export function authoringTools(
  traceEnabled = false,
  animationsEnabled = false,
) {
  const id = z.string().min(1);
  const review = { reviewId: id };

  // Anthropic rejects a top-level union, so publish one object; the host validates the union.
  const [image, trace] = uploadSchema.options;

  const uploadInput = z
    .strictObject({
      ...image.shape,
      ...trace.shape,
      kind: z.enum(["image", "trace"]),
    })
    .omit({ repositoryId: true })
    .extend({ repositoryPath: id })
    .partial()
    .required({ id: true, repositoryPath: true, kind: true });

  const descriptions = {
    create:
      'Create a whiteboard. target names its repository by the checkout\'s path, and what it shows: {kind:"project"} for a plan in that repository\'s project with no change; {kind:"worktree", base?} for the saved files in the checkout, uncommitted ones included and untracked ones left out (git add -N a new file to include it), against base, by default the repository\'s default branch, from the merge base of base and HEAD, which follows rebases; {kind:"commits", head, base?} for immutable commits (omitted base means source at head with no diff; supply the parent to review introduced changes); {kind:"pullRequest", pullRequest} for a GitHub PR by URL or number, fetched into that checkout and pinned at the PR head and GitHub diff base. For a branch stacked on another, pass the branch below it as base. Group plan implementations or a PR stack under one project-target overview with parentId, and order its children with dependsOn; Git bases do not set these relationships. Revisions are resolved on acceptance. With a PR and no title the PR\'s title is used. When the existing review for that PR is in Trash, creation reports its ID; restore it with review_lifecycle state:"active" before continuing. When an active review for that PR exists, it is returned instead, reporting whether its head moved and whether an agent is working on it; update it in place, move its target with review_set_target, or create a separate review with reuseExisting:false. The result carries review, as review_list shows it, with its target and repositoryPath, so no follow-up read is needed before diffing. When Desktop is available the review opens there and the result reports opened, softwareMapEnabled and environmentIssues, as review_open does; set open:false to author in the background without taking over Desktop. parentId and dependsOn set its place among the project\'s reviews, as review_set_parent and review_set_dependencies do; projectId files it in another project, by project.id from review_list.',
    set_target:
      "Move the review to a new target (the same targets review_create takes), such as the commits after a rebase or amend, or commits or a PR for a board that had none. The document and component IDs are kept. Revisions are resolved on acceptance. Returns warnings for retained source ranges in files the new commits changed, to verify, and resources that no longer match; fix them with review_edit. Earlier versions keep their source. A PR target names the PR; other targets keep it within the same repository and clear it across repositories.",
    edit: [
      "Edit one document component. content is one component, named by its type; each type's fields are in the Components section of session_get_instructions.",
      "Anchors are head/path#L10-L20 or base/path#L7, or diff/path#L84-R90 for a range across sides, with repository-relative paths and 1-based inclusive lines. pins {head, base?} say which commits of the whiteboard's repository anchors quote: a step, frame, attachment or operation without pins uses its block's, and a block without them the review's.",
      "insert adds content: parentId nests it, afterId places it, and omitted placement appends. update patches a component's own fields; null removes an optional one. A section's children and a diagram's units change through their own IDs; a call stack's frames change by replacing the call stack. move and remove take a targetId; removing a flow_node removes its edges.",
      "The host assigns short durable IDs. The result names the edited component and, for an insert or replace, its first-level children, and quotes the first and last line of each anchor the edit added or changed (the first 20; unquotedAnchors counts the rest): check they are the lines you meant. Accepted edits save at once. An edit to a block the user is editing is refused with an error: edit another block, or retry later.",
      "While a reader may be watching, write small and often: one paragraph per edit. Insert a new diagram whole. Change one already drawn a unit at a time (a flow_node, flow_edge or step, with parentId naming the diagram), and link each added flow_node to a node already drawn.",
    ].join("\n"),
    lens_edit:
      "Edit one Diff-view lens. Lenses partition the review's change for the Diff view; they sit beside the document (never in it) and version with it. The host assigns durable lens IDs; updates replace only the fields supplied. Write one lens per call while a reader may be watching; each draws in on the Diffs page. Pass your activityId so your courier draws each lens. The result identifies the lens and reports uncategorized: changed lines no lens selects yet, grouped by file. Keep adding lenses until it is empty or what remains is deliberate. review_lens_get reads the current lenses and gaps.",
    rename: "Change the review title.",
    restore:
      "Restore title, source pins, PR identity and content from a saved version.",
    attention:
      "Mark an active review viewed without changing its content or lifecycle. Restore a review from Trash before marking it viewed.",
    lifecycle:
      "Move a review between active and trash. Trash retains the review for 30 days before automatic deletion. Moving it back to active restores it; moving it to trash again does not restart that period.",
    delete:
      "Permanently delete a review and its history. The review must be in Trash. This cannot be undone. Its children move up to top level, and dependencies on it are dropped.",
    set_parent:
      "Nest the review under another review of the same project, or make it top-level with parentId:null. Nesting is one level deep: the parent must be top-level, and a review with children can't become a child. The sidebar shows children under their parent. Saves no review version. Returns the review's relations: parentId, children in sibling order, and dependsOn.",
    set_dependencies:
      "Replace the list of reviews this one builds on: any reviews of the same project. Siblings list after what they depend on, directly or through other reviews; a PR stack is a chain. A list that would close a cycle is refused, naming the cycle. Saves no review version. Returns the review's relations.",
  };

  const tool = (
    name: string,
    description: string,
    schema: z.ZodType,
    method: "GET" | "POST",
    path: string,
    commandType?: string,
  ) => ({
    name: `review_${name === "restore" ? "restore_version" : name}`,
    description,
    inputSchema: {
      ...withoutRepositoryIds(z.toJSONSchema(schema, { io: "input" })),
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
          : ""),
      instructionsQuerySchema
        .extend({
          topic: animationsEnabled
            ? instructionsQuerySchema.shape.topic
            : z
                .enum(["authoring", "file-lenses", "trace-archaeology"])
                .default("authoring"),
        })
        .partial(),
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

      // Hidden from agents: they name checkouts by path inside the target
      // and give PRs as a target.
      const {
        type: _type,
        repositoryId: _repositoryId,
        pullRequestUrl: _pullRequestUrl,
        ...fields
      }: Record<string, z.ZodType> = operation.shape;

      return tool(
        type,
        descriptions[type],
        z.strictObject({
          ...fields,
          ...(type === "create" && {
            target: pathTargetSchema,
            open: z.boolean().optional(),
          }),
          ...(type === "set_target" && { target: pathTargetSchema }),
          ...(type === "edit" && { edit: publishedEdits(animationsEnabled) }),
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
      "Show an active review immediately; restore it from Trash before opening it. Prepare current pinned checkouts in the background. Returns softwareMapEnabled and any already-recorded environmentIssues. Missing optional setup is not an issue; use review_environment to recheck.",
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
      "upload",
      'Retain an image or trace for use in a review. kind:"image" takes base64; kind:"trace" takes trace. Reusing an upload ID requires identical content; rejected uploads are not saved.',
      uploadInput,
      "POST",
      "/resources",
    ),
  ];
}

/** Drops repositoryId from pins: the host fills in the board's own. */
function withoutRepositoryIds<T>(schema: T): T {
  // SAFETY: a JSON round trip of a JSON Schema, dropping one property.
  return JSON.parse(JSON.stringify(schema), (_key, value: JsonValue) => {
    if (
      !isJsonObject(value) ||
      !isJsonObject(value.properties) ||
      !("repositoryId" in value.properties) ||
      !("head" in value.properties)
    )
      return value;

    const { repositoryId: _repositoryId, ...properties } = value.properties;

    return {
      ...value,
      properties,
      ...(Array.isArray(value.required) && {
        required: value.required.filter((name) => name !== "repositoryId"),
      }),
    };
  }) as T;
}
