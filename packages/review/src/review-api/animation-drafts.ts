// An animation, clip or diagram checked out as files, so an agent edits it
// with its own file tools and publishes the folder: the bytes travel by
// path, not through the agent's output. A clip's folder holds markers.json
// where an animation's holds frames.json; a diagram's holds diagram.html,
// diagram.js or both where the others hold animation.html.

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
import * as z from "zod";

import {
  type AnimationReference,
  readAnimationReferences,
} from "./animation-references.js";

const FILES = {
  html: "animation.html",
  script: "diagram.js",
  markup: "diagram.html",
  frames: "frames.json",
  markers: "markers.json",
  scenarios: "scenarios.json",
  block: "block.json",
  checkout: "checkout.json",
} as const;

/** The block types that check out as files. */
type DraftType = "animation" | "clip" | "diagram";

/** The fields block.json holds: everything but the ones with files of their own. */
const BLOCK_FIELDS: Record<DraftType, string[]> = {
  animation: ["title", "code", "height", "pins"],
  clip: ["title", "code", "height", "pins"],
  diagram: ["title", "description", "code", "stage", "timeline", "pins"],
};

/** Every field a block's files can set. */
const FIELDS: Record<DraftType, string[]> = {
  animation: ["html", "frames", "scenarios", ...BLOCK_FIELDS.animation],
  clip: ["html", "markers", "scenarios", ...BLOCK_FIELDS.clip],
  diagram: ["html", "script", "frames", "scenarios", ...BLOCK_FIELDS.diagram],
};

const isDraftType = (type: JsonValue | undefined): type is DraftType =>
  type === "animation" || type === "clip" || type === "diagram";

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
  /** wb.d.ts, the API a diagram's script draws with. */
  diagramApi: string;
  /** The reference diagrams an agent copies from. */
  diagrams: AnimationReference[];
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
  const diagramApi = path.join(directory, "wb.d.ts");
  const diagramCopies = path.join(directory, "diagram-references");

  const [sources, diagramSources] = await Promise.all([
    readAnimationReferences(root, { strict: false }),
    readAnimationReferences(root, { strict: false, folder: "diagrams" }),
  ]);

  await mkdir(copies, { recursive: true });
  await mkdir(diagramCopies, { recursive: true });
  await writeReadOnly(styles, stageStyleReference());
  await writeReadOnly(
    api,
    await readFile(path.join(root, "instructions", "whiteboard.d.ts"), "utf8"),
  );
  await writeReadOnly(
    diagramApi,
    await readFile(path.join(root, "instructions", "wb.d.ts"), "utf8"),
  );

  // Copies the references to `target`, dropping folders no longer shipped.
  const copyAll = async (list: AnimationReference[], target: string) => {
    const names = new Set(list.map(({ name }) => name));

    for (const stale of await readdir(target))
      if (!names.has(stale))
        await rm(path.join(target, stale), { recursive: true, force: true });

    return Promise.all(
      list.map(async (reference) => {
        const copy = path.join(target, reference.name);

        await copyReadOnly(reference.directory, copy);

        return { ...reference, directory: copy };
      }),
    );
  };

  const [references, diagrams] = await Promise.all([
    copyAll(sources, copies),
    copyAll(diagramSources, diagramCopies),
  ]);

  return { styles, api, references, diagramApi, diagrams };
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

/** The line that sends an agent to the API and references before it writes
 * a diagram. */
export const diagramReferenceHint = ({
  diagramApi,
  diagrams,
}: StageReference) =>
  `Before writing a diagram's script, read ${diagramApi} (the wb API it draws with).${diagrams.length ? ` Reference diagrams to start from are in ${path.dirname(diagrams[0]!.directory)}: read the README of the closest one.` : ""} All are read-only and rewritten by Whiteboard.`;

/** What follows the diagram instructions: the hint, then the references. */
export const diagramReferenceText = (reference: StageReference) =>
  [
    // The list below says where the references are; the hint need not.
    reference.diagrams.length
      ? `Before writing a diagram's script, read ${reference.diagramApi} (the wb API it draws with). It and the references are read-only and rewritten by Whiteboard.`
      : diagramReferenceHint(reference),
    ...(reference.diagrams.length
      ? [
          [
            "## References",
            "",
            "Before you write a diagram, read the README of the reference closest to what you are drawing, then copy its files into your draft folder as a starting point.",
            "",
            ...reference.diagrams.map(
              ({ name, summary, directory }) =>
                `- \`${name}\`: ${summary} ${directory}`,
            ),
          ].join("\n"),
        ]
      : []),
  ].join("\n\n");

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

function animationBlock(
  block: JsonValue,
  targetId: string,
): JsonObject & { type: DraftType } {
  if (!isJsonObject(block) || !isDraftType(block.type))
    throw new ReviewInputError(
      `${targetId} is ${isJsonObject(block) ? `a ${String(block.type)}` : "not a component"}; only animations, clips and diagrams check out as files.`,
    );

  return { ...block, type: block.type };
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

  if (block.type === "diagram") {
    if (block.html !== undefined) await put("markup", String(block.html));

    if (block.script !== undefined) await put("script", String(block.script));

    if (block.frames !== undefined) await put("frames", json(block.frames));
  } else {
    await put("html", String(block.html));

    if (block.type === "clip") await put("markers", json(block.markers ?? []));
    else await put("frames", json(block.frames ?? []));
  }

  if (block.scenarios !== undefined)
    await put("scenarios", json(block.scenarios));

  await put(
    "block",
    json(
      Object.fromEntries(
        Object.entries(block).filter(([key]) =>
          BLOCK_FIELDS[block.type].includes(key),
        ),
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
    next: `Edit these files with your file tools, then publish the folder: session_edit {sessionId, edit: {type: "update", targetId: "${targetId}", fromFiles: "${directory}"}}. ${block.type === "diagram" ? diagramReferenceHint(reference) : stageReferenceHint(reference)}`,
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
        `${path.join(directory, name)} does not exist. Check the block out with session_checkout, or write the file.`,
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

/** The animation, clip or diagram a folder holds, as a block's fields with
 * its type, checked as a publish would be. diagram.html or diagram.js makes it a diagram,
 * frames.json an animation and markers.json a clip. */
export async function readAnimationFolder(
  directory: string,
): Promise<JsonObject & { type: DraftType }> {
  const [markup, script, html, frames, markers, scenarios, block] =
    await Promise.all([
      readText(directory, FILES.markup, false),
      readText(directory, FILES.script, false),
      readText(directory, FILES.html, false),
      readJson(directory, FILES.frames, false),
      readJson(directory, FILES.markers, false),
      readJson(directory, FILES.scenarios, false),
      readJson(directory, FILES.block, true),
    ]);

  if (!isJsonObject(block))
    throw new ReviewInputError(`${FILES.block} must hold a JSON object.`);

  if (script !== undefined || markup !== undefined) {
    if (html !== undefined || markers !== undefined)
      throw new ReviewInputError(
        `${directory} holds ${script !== undefined ? FILES.script : FILES.markup} with ${html !== undefined ? FILES.html : FILES.markers}. A diagram's folder has ${FILES.markup}, ${FILES.script} or both, ${FILES.block} and, for steps, ${FILES.frames} and ${FILES.scenarios}.`,
      );

    const stray = Object.keys(block).filter(
      (key) => !BLOCK_FIELDS.diagram.includes(key),
    );

    if (stray.length)
      throw new ReviewInputError(
        `${FILES.block} holds only ${BLOCK_FIELDS.diagram.join(", ")}; move ${stray.join(", ")} out (the script is ${FILES.script}, frames ${FILES.frames}, scenarios ${FILES.scenarios}).`,
      );

    const fields: JsonObject & { type: DraftType } = {
      ...block,
      type: "diagram",
    };

    if (markup !== undefined) fields.html = markup;

    if (script !== undefined) fields.script = script;

    if (frames !== undefined) fields.frames = frames;

    if (scenarios !== undefined) fields.scenarios = scenarios;

    validate(fields);

    return fields;
  }

  if (html === undefined)
    throw new ReviewInputError(
      `${path.join(directory, FILES.html)} does not exist. Write ${FILES.markup} or ${FILES.script} for a diagram, or ${FILES.html} for an animation or clip, or check one out with session_checkout.`,
    );

  if (frames !== undefined && markers !== undefined)
    throw new ReviewInputError(
      `${directory} holds both ${FILES.frames} and ${FILES.markers}. Keep ${FILES.frames} for an animation or ${FILES.markers} for a clip, not both.`,
    );

  if (frames === undefined && markers === undefined)
    throw new ReviewInputError(
      `${path.join(directory, FILES.frames)} does not exist. Write ${FILES.frames} for an animation or ${FILES.markers} for a clip, or check one out with session_checkout.`,
    );

  const stray = Object.keys(block).filter(
    (key) => !BLOCK_FIELDS.animation.includes(key),
  );

  if (stray.length)
    throw new ReviewInputError(
      `${FILES.block} holds only ${BLOCK_FIELDS.animation.join(", ")}; move ${stray.join(", ")} out (html is ${FILES.html}, frames ${FILES.frames} or markers ${FILES.markers}, scenarios ${FILES.scenarios}).`,
    );

  const fields: JsonObject & { type: DraftType } =
    markers === undefined
      ? { ...block, type: "animation", html, frames: frames! }
      : { ...block, type: "clip", html, markers };

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
function located(issuePath: PropertyKey[], type: DraftType): string {
  const [field, ...rest] = issuePath.map(String);

  const at = rest
    .map((part) => (/^\d+$/.test(part) ? `[${part}]` : `.${part}`))
    .join("");

  if (field === "html") return type === "diagram" ? FILES.markup : FILES.html;

  if (field === "script") return FILES.script;

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
        .map((issue) => `${located(issue.path, fields.type)}: ${issue.message}`)
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
      `${directory} holds a ${fields.type} but ${targetId} is a ${current.type}. Publish it with type "replace" to change its kind.`,
    );

  const changes: JsonObject = {};

  for (const field of FIELDS[fields.type])
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
