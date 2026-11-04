// An animation or clip checked out as files, so an agent edits it with its
// own file tools and publishes the folder: the bytes travel by path, not
// through the agent's output. A clip's folder holds markers.json where an
// animation's holds frames.json.

import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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

import {
  type AnimationReference,
  readAnimationReferences,
} from "./animation-references.js";

const FILES = {
  html: "animation.html",
  frames: "frames.json",
  markers: "markers.json",
  scenarios: "scenarios.json",
  block: "block.json",
  checkout: "checkout.json",
} as const;

/** The fields block.json holds: everything but the ones with files of their own. */
const BLOCK_FIELDS = ["title", "code", "height", "pins"];

/** Every field an animation's or clip's files can set. */
const FIELDS = ["html", "frames", "markers", "scenarios", ...BLOCK_FIELDS];

/** The block types that check out as files. */
type DraftType = "animation" | "clip";

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
 * animation loads, whiteboard.d.ts, the API its scripts call, and the
 * reference animations an agent copies from. */
export interface StageReference {
  styles: string;
  api: string;
  references: AnimationReference[];
}

async function writeReadOnly(file: string, content: string): Promise<void> {
  // A read-only file can still be replaced: remove it, then write anew.
  await rm(file, { force: true });
  await writeFile(file, content, { mode: 0o444 });
}

/** Copies `source` to `target` with every file read-only, replacing what was there. */
async function copyReadOnly(source: string, target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });

  for (const entry of await readdir(target, {
    recursive: true,
    withFileTypes: true,
  }))
    if (entry.isFile())
      await chmod(path.join(entry.parentPath, entry.name), 0o444);
}

export async function writeStageReference(
  root = findReviewPackageRoot(import.meta.url),
): Promise<StageReference> {
  const directory = path.join(devReviewHome(), "animation-drafts");
  const styles = path.join(directory, "whiteboard.css");
  const api = path.join(directory, "whiteboard.d.ts");
  const copies = path.join(directory, "references");
  const sources = await readAnimationReferences(root, { strict: false });

  await mkdir(copies, { recursive: true });
  await writeReadOnly(styles, stageStyleReference());
  await writeReadOnly(
    api,
    await readFile(path.join(root, "instructions", "whiteboard.d.ts"), "utf8"),
  );

  const names = new Set(sources.map(({ name }) => name));

  for (const stale of await readdir(copies))
    if (!names.has(stale))
      await rm(path.join(copies, stale), { recursive: true, force: true });

  const references = await Promise.all(
    sources.map(async (reference) => {
      const copy = path.join(copies, reference.name);

      await copyReadOnly(reference.directory, copy);

      return { ...reference, directory: copy };
    }),
  );

  return { styles, api, references };
}

/** The line that sends an agent to the references before it writes an animation. */
export const stageReferenceHint = ({
  styles,
  api,
  references,
}: StageReference) =>
  `Before writing or restyling an animation's HTML, read ${styles} (the classes and --wb-* variables every animation loads) and ${api} (the whiteboard API its scripts call).${references.length ? ` Reference animations to start from are in ${path.dirname(references[0]!.directory)}: read the README of the closest one.` : ""} All are read-only and rewritten by Whiteboard.`;

/** Lists the reference animations where the agent can read them. */
function referencesSection({ references }: StageReference): string[] {
  if (!references.length) return [];

  return [
    [
      "## References",
      "",
      "Before you write an animation, read the README of the reference closest to what you are drawing, then copy its files into your draft folder as a starting point.",
      "",
      ...references.map(
        ({ name, summary, directory }) =>
          `- \`${name}\`: ${summary} ${directory}`,
      ),
    ].join("\n"),
  ];
}

/** What follows the animation instructions: the hint, then the references. */
export const stageReferenceText = (reference: StageReference) =>
  [stageReferenceHint(reference), ...referencesSection(reference)].join("\n\n");

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
  if (
    !isJsonObject(block) ||
    (block.type !== "animation" && block.type !== "clip")
  )
    throw new ReviewInputError(
      `${targetId} is ${isJsonObject(block) ? `a ${String(block.type)}` : "not a component"}; only animations and clips check out as files.`,
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

  if (block.type === "clip") await put("markers", json(block.markers ?? []));
  else await put("frames", json(block.frames ?? []));

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
    styles: reference.styles,
    api: reference.api,
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
        `${path.join(directory, name)} does not exist. Check the animation or clip out with session_checkout, or write the file.`,
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

/** The animation or clip a folder holds, as a block's fields with its type,
 * checked as a publish would be. frames.json makes it an animation and
 * markers.json a clip. */
export async function readAnimationFolder(
  directory: string,
): Promise<JsonObject & { type: DraftType }> {
  const [html, frames, markers, scenarios, block] = await Promise.all([
    readText(directory, FILES.html, true),
    readJson(directory, FILES.frames, false),
    readJson(directory, FILES.markers, false),
    readJson(directory, FILES.scenarios, false),
    readJson(directory, FILES.block, true),
  ]);

  if (frames !== undefined && markers !== undefined)
    throw new ReviewInputError(
      `${directory} holds both ${FILES.frames} and ${FILES.markers}. Keep ${FILES.frames} for an animation or ${FILES.markers} for a clip, not both.`,
    );

  if (frames === undefined && markers === undefined)
    throw new ReviewInputError(
      `${path.join(directory, FILES.frames)} does not exist. Write ${FILES.frames} for an animation or ${FILES.markers} for a clip, or check one out with session_checkout.`,
    );

  if (!isJsonObject(block))
    throw new ReviewInputError(`${FILES.block} must hold a JSON object.`);

  const stray = Object.keys(block).filter((key) => !BLOCK_FIELDS.includes(key));

  if (stray.length)
    throw new ReviewInputError(
      `${FILES.block} holds only ${BLOCK_FIELDS.join(", ")}; move ${stray.join(", ")} out (html is ${FILES.html}, frames ${FILES.frames} or markers ${FILES.markers}, scenarios ${FILES.scenarios}).`,
    );

  const fields: JsonObject & { type: DraftType } =
    markers === undefined
      ? { ...block, type: "animation", html: html!, frames: frames! }
      : { ...block, type: "clip", html: html!, markers };

  if (scenarios !== undefined) fields.scenarios = scenarios;

  validate(fields);

  return fields;
}

/** The animation a folder holds, as a block's fields, and where it came from. */
async function readDraft(directory: string) {
  const [fields, checkout] = await Promise.all([
    readAnimationFolder(directory),
    readJson(directory, FILES.checkout, false),
  ]);

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

  if (field === "frames" || field === "markers" || field === "scenarios")
    return `${FILES[field]} ${at.replace(/^\./, "") || "(top level)"}`;

  return `${FILES.block} ${field ?? ""}${at}`;
}

/** Checks the files before anything is sent, so an issue names its file. The
 * host checks pins: agents write them without the repository it fills in. */
function validate(fields: JsonObject & { type: DraftType }) {
  const { pins: _pins, ...rest } = fields;
  const parsed = blocks[fields.type].schema.safeParse(rest);

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
 * folder's animation or clip as an insert's or replace's content, or as an
 * update's changed fields. An update from a checkout is refused once the block has
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
    return { directory, edit: { ...rest, content: fields } };

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
    return { directory, edit: { ...rest, content: fields } };

  if (rest.type !== "update")
    throw new ReviewInputError(
      "fromFiles publishes an insert, replace or update.",
    );

  if (current.type !== fields.type)
    throw new ReviewInputError(
      `${directory} holds ${fields.type === "clip" ? "a clip" : "an animation"} but ${targetId} is ${current.type === "clip" ? "a clip" : "an animation"}. Publish it with type "replace" to change its kind.`,
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
