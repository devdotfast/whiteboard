import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { type JsonValue, isJsonObject, isStringValue } from "@dev.fast/json";
import { boardTitle } from "@dev.fast/review-protocol";
import { devReviewHome } from "@dev.fast/trace-core";
import { ReviewInputError } from "@dev.fast/whiteboard-document";

import {
  type AuthoringTool,
  ToolText,
  callAuthoringTool,
} from "./agent-client.js";
import {
  type ReadBlock,
  checkoutAnimation,
  diagramReferenceText,
  recordPublish,
  resolveDraftEdit,
  stageReferenceText,
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

  if (
    tool.name === "session_get_instructions" &&
    (rest.topic === "animation" || rest.topic === "diagram")
  ) {
    const instructions = await callAuthoringTool(client, tool, fields, signal);
    const reference = await writeStageReference();

    const hint =
      rest.topic === "diagram"
        ? diagramReferenceText(reference)
        : stageReferenceText(reference);

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
    tool.name === "session_render" &&
    isStringValue(sessionId) &&
    isStringValue(rest.targetId)
  )
    return saveRenderedFrame(published, sessionId, rest.targetId);

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

/** A tool result with its rendered frame, if any, taken out as an image. */
export interface RenderedImage {
  image?: { data: string; mimeType: "image/png" };
  result: JsonValue | ToolText;
}

/** A rendered frame's PNG, for an agent that reads images from a tool
 * result, and the rest of the result for its text. */
export function renderedImage(
  tool: Pick<AuthoringTool, "name">,
  result: JsonValue | ToolText,
): RenderedImage {
  if (
    tool.name !== "session_render" ||
    result instanceof ToolText ||
    !isJsonObject(result) ||
    !isStringValue(result.png)
  )
    return { result };

  const { png, ...rest } = result;

  return { image: { data: png, mimeType: "image/png" }, result: rest };
}

/** Writes the frame's PNG where the agent can open it with its own tools,
 * beside the animation drafts, and names the file in the result. A folder
 * that cannot be written leaves the image in the result alone. */
async function saveRenderedFrame(
  result: JsonValue,
  sessionId: string,
  targetId: string,
): Promise<JsonValue> {
  // Every frame at once: each PNG goes to its own file, and the result
  // names the files rather than carrying the images.
  if (isJsonObject(result) && Array.isArray(result.frames))
    return {
      ...result,
      frames: await Promise.all(
        result.frames.map(async (frame) => {
          const saved = await saveRenderedFrame(frame, sessionId, targetId);

          if (!isJsonObject(saved) || !isStringValue(saved.file)) return saved;
          const { png: _png, ...rest } = saved;

          return rest;
        }),
      ),
    };

  if (!isJsonObject(result) || !isStringValue(result.png)) return result;

  const frame =
    isJsonObject(result.frame) && isStringValue(result.frame.key)
      ? result.frame.key
      : "frame";

  // A frame shared by scenarios renders once in each.
  const key = isStringValue(result.scenario)
    ? `${result.scenario}-${frame}`
    : frame;

  const file = path.join(
    devReviewHome(),
    "animation-renders",
    ...[sessionId, targetId, `${key}.png`].map((part) =>
      part.replace(/[^\w.-]/g, "_"),
    ),
  );

  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(result.png, "base64"));
  } catch {
    return result;
  }

  return { ...result, file };
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
