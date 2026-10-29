import { type JsonValue, isJsonObject, isStringValue } from "@dev.fast/json";
import { boardTitle } from "@dev.fast/review-protocol";
import { ReviewInputError } from "@dev.fast/whiteboard-document";

import {
  type AuthoringTool,
  ToolText,
  callAuthoringTool,
} from "./agent-client.js";
import {
  type ReadBlock,
  checkoutAnimation,
  recordPublish,
  resolveDraftEdit,
  stageReferenceHint,
  writeStageReference,
} from "./animation-drafts.js";
import type { ReviewApiClient } from "./client.js";

function publicDescription(text: string): string {
  return text
    .replace(/\breview_(\w+)/g, "session_$1")
    .replace(/\breviewId\b/g, "sessionId")
    .replace(/\bReview\b/g, "Whiteboard")
    .replace("The result carries review,", "The result carries session,");
}

/** Rewrite schema prose without changing property names, enum values or examples. */
function translateSchemaDescriptions(value: JsonValue): void {
  if (Array.isArray(value)) {
    value.forEach(translateSchemaDescriptions);

    return;
  }

  if (!isJsonObject(value)) return;

  for (const [key, item] of Object.entries(value)) {
    if (key === "description" && isStringValue(item))
      value[key] = publicDescription(item);
    else if (!["examples", "default", "const", "enum"].includes(key))
      translateSchemaDescriptions(item);
  }
}

/** Public vocabulary belongs to the agent boundary, not stored documents. */
export function publicTool(tool: AuthoringTool): AuthoringTool {
  const inputSchema = structuredClone(tool.inputSchema);

  if (isJsonObject(inputSchema)) translateSchemaDescriptions(inputSchema);

  inputSchema.properties = Object.fromEntries(
    Object.entries(inputSchema.properties ?? {}).map(([key, value]) => [
      key === "reviewId" ? "sessionId" : key,
      value,
    ]),
  );

  if (inputSchema.required)
    inputSchema.required = inputSchema.required.map((key) =>
      key === "reviewId" ? "sessionId" : key,
    );

  return {
    ...tool,
    name: tool.name.replace(/^review_/, "session_"),
    description: publicDescription(tool.description),
    inputSchema,
  };
}

/** Translate known response envelopes only; authored content is opaque. */
export function publicResult(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(publicResult);

  if (!isJsonObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const name =
        key === "reviewId"
          ? "sessionId"
          : key === "review"
            ? "session"
            : key === "reviews"
              ? "sessions"
              : key;

      return [
        name,
        key === "review" || key === "reviews"
          ? publicResult(item)
          : // A board's title as every surface shows it: an empty one is
            // "Untitled".
            key === "title" && "reviewId" in value && isStringValue(item)
            ? boardTitle(item)
            : item,
      ];
    }),
  );
}

export async function callPublicTool(
  client: ReviewApiClient,
  tool: AuthoringTool,
  input: Parameters<typeof callAuthoringTool>[2],
  signal?: AbortSignal,
) {
  if ("reviewId" in input) throw new Error("Use sessionId with session tools.");
  const { sessionId, ...rest } = input;

  const fields: Parameters<typeof callAuthoringTool>[2] = { ...rest };

  if (sessionId !== undefined) fields.reviewId = sessionId;

  // Animation drafts are files beside the agent: this side reads and writes
  // them, and the host sees only ordinary reads and edits.
  const read: ReadBlock = async (reviewId, targetId) => {
    const block = await callAuthoringTool(
      client,
      INSPECT,
      { reviewId, targetId, format: "json" },
      signal,
    );

    if (block instanceof ToolText)
      throw new Error(`Whiteboard did not return ${targetId} as JSON.`);

    return withoutRepositoryIds(block);
  };

  if (tool.name === "session_get_instructions" && rest.topic === "animation") {
    const instructions = await callAuthoringTool(client, tool, fields, signal);
    const hint = stageReferenceHint(await writeStageReference());

    if (instructions instanceof ToolText)
      return new ToolText(`${instructions.text}\n\n${hint}`);

    return isStringValue(instructions)
      ? `${instructions}\n\n${hint}`
      : instructions;
  }

  if (tool.name === "session_checkout") {
    const { targetId, dir } = rest;

    if (!isStringValue(sessionId) || !isStringValue(targetId))
      throw new ReviewInputError("sessionId and targetId are required.");

    return checkoutAnimation(
      read,
      sessionId,
      targetId,
      isStringValue(dir) ? dir : undefined,
    );
  }

  const draft =
    tool.commandType === "edit" &&
    isStringValue(sessionId) &&
    isJsonObject(rest.edit) &&
    "fromFiles" in rest.edit
      ? await resolveDraftEdit(read, sessionId, rest.edit)
      : undefined;

  if (draft?.unchanged) return draft.unchanged;

  if (draft?.edit) fields.edit = draft.edit;
  const result = await callAuthoringTool(client, tool, fields, signal);

  if (result instanceof ToolText) return result;
  const published = withoutRepositoryIds(publicResult(result));

  if (
    draft &&
    isStringValue(sessionId) &&
    isJsonObject(published) &&
    isStringValue(published.targetId)
  )
    // The edit is saved; a folder that can't follow it only needs a new
    // checkout before its next publish.
    await recordPublish(
      read,
      sessionId,
      published.targetId,
      draft.directory,
    ).catch(() => {});

  return published;
}

/** The read a draft compares and records against: session_get's JSON. */
const INSPECT: AuthoringTool = {
  name: "review_get",
  description: "",
  inputSchema: { type: "object" },
  method: "GET",
  path: "/:reviewId/inspect",
};

/** Agents never see repository ids. */
function withoutRepositoryIds(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(withoutRepositoryIds);

  if (!isJsonObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "repositoryId")
      .map(([key, item]) => [key, withoutRepositoryIds(item)]),
  );
}
