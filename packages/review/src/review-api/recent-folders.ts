import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export interface RecentFoldersEnvironment {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/** VS Code forks whose recently opened folders count as projects. */
const EDITORS = ["Cursor", "Code"];

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/** A file's JSON as `schema` reads it, or undefined when it is missing,
 * malformed, or shaped otherwise: another app's file, read on its terms. */
async function readJson<Schema extends z.ZodType>(
  file: string,
  schema: Schema,
): Promise<z.infer<Schema> | undefined> {
  const text = await readText(file);

  try {
    return text === undefined
      ? undefined
      : schema.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
}

const claudeConfigSchema = z.object({
  projects: z.record(z.string(), z.object({}).loose()),
});

/** Claude Code keeps per-folder settings for every folder it ran in. */
async function claudeFolders(homeDir: string, env: NodeJS.ProcessEnv) {
  const config = await readJson(
    path.join(env.CLAUDE_CONFIG_DIR ?? homeDir, ".claude.json"),
    claudeConfigSchema,
  );

  return Object.keys(config?.projects ?? {});
}

/** Codex records each folder it was trusted in as a `[projects."…"]` table. */
export function codexConfigFolders(toml: string): string[] {
  const folders: string[] = [];

  for (const match of toml.matchAll(
    /^\[projects\.(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\]/gmu,
  )) {
    if (match[2] !== undefined) folders.push(match[2]);
    else if (match[1] !== undefined)
      try {
        // A TOML basic string escapes as JSON does for paths.
        folders.push(JSON.parse(`"${match[1]}"`));
      } catch {
        // An escape JSON lacks: not a path worth guessing at.
      }
  }

  return folders;
}

async function codexFolders(homeDir: string, env: NodeJS.ProcessEnv) {
  const toml = await readText(
    path.join(env.CODEX_HOME ?? path.join(homeDir, ".codex"), "config.toml"),
  );

  return toml === undefined ? [] : codexConfigFolders(toml);
}

function editorDataDir(
  app: string,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) {
  if (platform === "darwin")
    return path.join(homeDir, "Library", "Application Support", app);

  if (platform === "win32")
    return path.join(
      env.APPDATA ?? path.join(homeDir, "AppData", "Roaming"),
      app,
    );

  return path.join(env.XDG_CONFIG_HOME ?? path.join(homeDir, ".config"), app);
}

/** The parts of an editor's storage.json that name folders; either can be
 * missing or reshaped by another version without losing the other. */
const editorStorageSchema = z.object({
  profileAssociations: z
    .object({ workspaces: z.record(z.string(), z.unknown()) })
    .optional()
    .catch(undefined),
  backupWorkspaces: z
    .object({ folders: z.array(z.object({ folderUri: z.string() })) })
    .optional()
    .catch(undefined),
});

/** The folders an editor opened: those with a profile, and those with
 * unsaved work. Both live in its storage.json, unlike its sqlite history. */
function editorStorageFolders(
  storage: z.infer<typeof editorStorageSchema>,
): string[] {
  const uris = [
    ...Object.keys(storage.profileAssociations?.workspaces ?? {}),
    ...(storage.backupWorkspaces?.folders ?? []).map(
      (folder) => folder.folderUri,
    ),
  ];

  return uris.flatMap((uri) => {
    if (!uri.startsWith("file://")) return [];

    try {
      return [fileURLToPath(uri)];
    } catch {
      return [];
    }
  });
}

async function editorFolders(
  app: string,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) {
  const storage = await readJson(
    path.join(
      editorDataDir(app, homeDir, env, platform),
      "User",
      "globalStorage",
      "storage.json",
    ),
    editorStorageSchema,
  );

  return storage ? editorStorageFolders(storage) : [];
}

/** Folders the user's agents and editors have worked in, unverified: some
 * are gone, and many are not repositories or are inside one. */
export async function recentFolders(
  input: RecentFoldersEnvironment = {},
): Promise<string[]> {
  const homeDir = input.homeDir ?? os.homedir();
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;

  const lists = await Promise.all([
    claudeFolders(homeDir, env),
    codexFolders(homeDir, env),
    ...EDITORS.map((app) => editorFolders(app, homeDir, env, platform)),
  ]);

  return [...new Set(lists.flat().filter((folder) => path.isAbsolute(folder)))];
}
