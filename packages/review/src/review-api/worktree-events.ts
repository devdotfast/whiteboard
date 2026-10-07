import { execFile } from "node:child_process";
import { isAbsolute, relative } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const normalize = (name: string) => name.replaceAll("\\", "/").normalize("NFC");

const parent = (file: string) =>
  file.slice(0, Math.max(0, file.lastIndexOf("/")));

/** Directories that hold tracked files, the root as "". */
export function trackedDirectories(files: readonly string[]): Set<string> {
  const directories = new Set([""]);

  for (const file of files)
    for (
      let dir = parent(normalize(file));
      !directories.has(dir);
      dir = parent(dir)
    )
      directories.add(dir);

  return directories;
}

/** Only a tracked directory's entries can change an inspection. */
export function rootEventMatters(
  name: string,
  tracked: Set<string> | undefined,
): boolean {
  const file = normalize(name);

  // The git directory has its own watcher.
  if (file === ".git" || file.startsWith(".git/")) return false;

  return !tracked || tracked.has(parent(file));
}

// A checkout's own state, per gitrepository-layout(5).
const CHECKOUT_STATE =
  /^(?:index|[A-Z_]+|(?:rebase-merge|rebase-apply|sequencer|refs\/(?:bisect|worktree|rewritten))(?:\/.*)?)$/;

/** Objects, reflogs, locks and other checkouts' state cannot change this one. */
export function gitEventMatters(name: string, prefix: string): boolean {
  const file = normalize(name);

  if (file.endsWith(".lock") || /^(?:objects|logs)\//.test(file)) return false;

  if (file.startsWith("worktrees/"))
    return file.startsWith(`${prefix}/`) && !file.startsWith(`${prefix}/logs/`);

  return !prefix || !CHECKOUT_STATE.test(file);
}

/** Where this checkout's git directory sits in the common one: "" for the main checkout. */
export async function gitDirectoryPrefix(
  rootPath: string,
  common: string,
): Promise<string | null> {
  try {
    const { stdout } = await exec("git", [
      "-C",
      rootPath,
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
    ]);

    const prefix = normalize(relative(common, stdout.trim()));

    return isAbsolute(prefix) || prefix.startsWith("..") ? null : prefix;
  } catch {
    return null;
  }
}
