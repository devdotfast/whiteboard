// An animation checked out as files, so an agent edits it with its own file
// tools and publishes the folder: the bytes travel by path, not through the
// agent's output.

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type JsonObject,
  type JsonValue,
  isJsonObject,
  isStringValue,
  parseJsonText,
} from "@dev.fast/json";
import { devReviewHome } from "@dev.fast/trace-core";
import {
  ReviewInputError,
  blocks,
  checkReferences,
} from "@dev.fast/whiteboard-document";
import { stageStyleReference } from "@review/animation-stage-kit.js";
import { isMissingFileError } from "@review/fs-utils.js";
import { findReviewPackageRoot } from "@review/package-paths.js";
import { z } from "zod";

const FILES = {
  html: "animation.html",
  frames: "frames.json",
  scenarios: "scenarios.json",
  block: "block.json",
  checkout: "checkout.json",
} as const;

/** The fields block.json holds: everything but the ones with files of their own. */
const BLOCK_FIELDS = ["title", "code", "height", "pins"];

/** Every field an animation's files can set. */
const FIELDS = ["html", "frames", "scenarios", ...BLOCK_FIELDS];

/** What checkout.json records: the block the folder came from, as it was. */
const checkoutSchema = z.strictObject({
  sessionId: z.string(),
  targetId: z.string(),
  base: z.string(),
});

type Checkout = z.infer<typeof checkoutSchema>;

/** Reads one block as the agent sees it in session_get's JSON. */
export type ReadBlock = (
  sessionId: string,
  targetId: string,
) => Promise<JsonValue>;

const handle = /^[\w-]{1,128}$/;

/** The animation references, read-only beside the drafts so they always match
 * the Whiteboard that wrote them: whiteboard.css, the style kit every
 * animation loads, and whiteboard.d.ts, the API its scripts call. */
export interface StageReference {
  styles: string;
  api: string;
}

async function writeReadOnly(file: string, content: string): Promise<void> {
  // A read-only file can still be replaced: remove it, then write anew.
  await rm(file, { force: true });
  await writeFile(file, content, { mode: 0o444 });
}

export async function writeStageReference(): Promise<StageReference> {
  const directory = path.join(devReviewHome(), "animation-drafts");
  const styles = path.join(directory, "whiteboard.css");
  const api = path.join(directory, "whiteboard.d.ts");

  const source = path.join(
    findReviewPackageRoot(import.meta.url),
    "instructions",
    "whiteboard.d.ts",
  );

  await mkdir(directory, { recursive: true });
  await writeReadOnly(styles, stageStyleReference());
  await writeReadOnly(api, await readFile(source, "utf8"));

  return { styles, api };
}

/** The line that sends an agent to the references before it writes an animation. */
export const stageReferenceHint = ({ styles, api }: StageReference) =>
  `Before writing or restyling an animation's HTML, read ${styles} (the classes and --wb-* variables every animation loads) and ${api} (the whiteboard API its scripts call). Both are read-only and rewritten by Whiteboard.`;

export function draftDirectory(
  sessionId: string,
  targetId: string,
  dir?: string,
): string {
  if (dir) return path.resolve(dir);

  if (!handle.test(sessionId) || !handle.test(targetId))
    throw new ReviewInputError("sessionId and targetId must be IDs.");

  return path.join(devReviewHome(), "animation-drafts", sessionId, targetId);
}

const fingerprint = (block: JsonValue) =>
  createHash("sha256").update(JSON.stringify(block)).digest("hex");

const json = (value: JsonValue) => `${JSON.stringify(value, null, 2)}\n`;

function animationBlock(block: JsonValue, targetId: string): JsonObject {
  if (!isJsonObject(block) || block.type !== "animation")
    throw new ReviewInputError(
      `${targetId} is ${isJsonObject(block) ? `a ${String(block.type)}` : "not a component"}; only animations check out as files.`,
    );

  return block;
}

/** Writes the block's files, replacing any earlier draft in the folder. */
export async function checkoutAnimation(
  read: ReadBlock,
  sessionId: string,
  targetId: string,
  dir?: string,
) {
  const block = animationBlock(await read(sessionId, targetId), targetId);
  const directory = draftDirectory(sessionId, targetId, dir);

  await mkdir(directory, { recursive: true });
  await Promise.all(
    Object.values(FILES).map((name) =>
      rm(path.join(directory, name), { force: true }),
    ),
  );

  const files: Record<string, string> = {};

  const put = async (key: keyof typeof FILES, text: string) => {
    files[key] = path.join(directory, FILES[key]);
    await writeFile(files[key], text);
  };

  await put("html", String(block.html));
  await put("frames", json(block.frames ?? []));

  if (block.scenarios !== undefined)
    await put("scenarios", json(block.scenarios));

  await put(
    "block",
    json(
      Object.fromEntries(
        Object.entries(block).filter(([key]) => BLOCK_FIELDS.includes(key)),
      ),
    ),
  );
  await writeCheckout(directory, {
    sessionId,
    targetId,
    base: fingerprint(block),
  });

  const reference = await writeStageReference();

  return {
    directory,
    files,
    ...reference,
    next: `Edit these files with your file tools, then publish the folder: session_edit {sessionId, edit: {type: "update", targetId: "${targetId}", fromFiles: "${directory}"}}. ${stageReferenceHint(reference)}`,
  };
}

async function writeCheckout(directory: string, checkout: Checkout) {
  await writeFile(path.join(directory, FILES.checkout), json({ ...checkout }));
}

async function readText(directory: string, name: string, required: boolean) {
  try {
    return await readFile(path.join(directory, name), "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) throw error;

    if (required)
      throw new ReviewInputError(
        `${path.join(directory, name)} does not exist. Check the animation out with session_checkout, or write the file.`,
      );

    return undefined;
  }
}

async function readJson(directory: string, name: string, required: boolean) {
  const text = await readText(directory, name, required);

  if (text === undefined) return undefined;

  try {
    return parseJsonText(text);
  } catch (error) {
    throw new ReviewInputError(
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The animation a folder holds, as a block's fields, and where it came from. */
async function readDraft(directory: string) {
  const [html, frames, scenarios, block, checkout] = await Promise.all([
    readText(directory, FILES.html, true),
    readJson(directory, FILES.frames, true),
    readJson(directory, FILES.scenarios, false),
    readJson(directory, FILES.block, true),
    readJson(directory, FILES.checkout, false),
  ]);

  if (!isJsonObject(block))
    throw new ReviewInputError(`${FILES.block} must hold a JSON object.`);

  const stray = Object.keys(block).filter((key) => !BLOCK_FIELDS.includes(key));

  if (stray.length)
    throw new ReviewInputError(
      `${FILES.block} holds only ${BLOCK_FIELDS.join(", ")}; move ${stray.join(", ")} out (html is ${FILES.html}, frames ${FILES.frames}, scenarios ${FILES.scenarios}).`,
    );

  const fields: JsonObject = { ...block, html: html!, frames: frames! };

  if (scenarios !== undefined) fields.scenarios = scenarios;

  validate(fields);

  const parsed = checkoutSchema.safeParse(checkout);

  return { fields, checkout: parsed.success ? parsed.data : undefined };
}

/** The file an issue at `issuePath` is in, and where inside it. */
function located(issuePath: PropertyKey[]): string {
  const [field, ...rest] = issuePath.map(String);

  const at = rest
    .map((part) => (/^\d+$/.test(part) ? `[${part}]` : `.${part}`))
    .join("");

  if (field === "html") return FILES.html;

  if (field === "frames" || field === "scenarios")
    return `${FILES[field]} ${at.replace(/^\./, "") || "(top level)"}`;

  return `${FILES.block} ${field ?? ""}${at}`;
}

/** Checks the files before anything is sent, so an issue names its file. The
 * host checks pins: agents write them without the repository it fills in. */
function validate(fields: JsonObject) {
  const { pins: _pins, ...rest } = fields;

  const parsed = blocks.animation.schema.safeParse({
    ...rest,
    type: "animation",
  });

  if (!parsed.success)
    throw new ReviewInputError(
      parsed.error.issues
        .map((issue) => `${located(issue.path)}: ${issue.message}`)
        .join("\n"),
    );

  checkReferences([parsed.data]);
}

/**
 * Turns an edit that names a draft folder into the edit the host takes: the
 * folder's animation as an insert's or replace's content, or as an update's
 * changed fields. An update from a checkout is refused once the block has
 * changed since. Returns `unchanged` when the files match the block.
 */
export async function resolveDraftEdit(
  read: ReadBlock,
  sessionId: string,
  edit: JsonObject,
) {
  const { fromFiles, ...rest } = edit;

  if (!isStringValue(fromFiles) || !fromFiles)
    throw new ReviewInputError("fromFiles must name a draft folder.");

  if ("content" in rest || "changes" in rest)
    throw new ReviewInputError("Give fromFiles or content/changes, not both.");

  const directory = path.resolve(fromFiles);
  const { fields, checkout } = await readDraft(directory);

  if (rest.type === "insert")
    return {
      directory,
      edit: { ...rest, content: { type: "animation", ...fields } },
    };

  const targetId = String(rest.targetId);
  const current = animationBlock(await read(sessionId, targetId), targetId);

  if (
    checkout &&
    checkout.sessionId === sessionId &&
    checkout.targetId === targetId &&
    checkout.base !== fingerprint(current)
  )
    throw new ReviewInputError(
      `${targetId} changed after it was checked out to ${directory}. Check it out again with session_checkout, then reapply your edits.`,
      409,
    );

  if (rest.type === "replace")
    return {
      directory,
      edit: { ...rest, content: { type: "animation", ...fields } },
    };

  if (rest.type !== "update")
    throw new ReviewInputError(
      "fromFiles publishes an insert, replace or update.",
    );

  const changes: JsonObject = {};

  for (const field of FIELDS)
    if (JSON.stringify(fields[field]) !== JSON.stringify(current[field]))
      changes[field] = fields[field] ?? null;

  return Object.keys(changes).length
    ? { directory, edit: { ...rest, changes } }
    : { directory, unchanged: { targetId, unchanged: true } };
}

/** After a publish, the folder follows the block it wrote, so the next edit
 * and publish of the same folder needs no new checkout. */
export async function recordPublish(
  read: ReadBlock,
  sessionId: string,
  targetId: string,
  directory: string,
) {
  const block = await read(sessionId, targetId);

  await writeCheckout(directory, {
    sessionId,
    targetId,
    base: fingerprint(block),
  });
}
