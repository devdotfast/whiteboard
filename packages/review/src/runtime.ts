import path from "node:path";

import { runVcs } from "@dev.fast/local-vcs";

export async function resolveReviewRoot(
  cwd: string,
  execFile: typeof execFilePromise = execFilePromise,
): Promise<string> {
  const initialCwd = path.resolve(cwd);

  try {
    // cwd-based invocation: jj walks up from cwd like git does, while
    // `-R <subdir>` fails for a subdirectory of a workspace and would
    // silently fall back to git's cwd walk (the OUTER repo, for a
    // non-colocated jj workspace nested in another git repo).
    const { stdout } = await execFile("jj", ["root"], { cwd: initialCwd });
    const root = stdout.trim();

    if (root) return path.resolve(root);
  } catch {
    // Not a jj workspace, or jj is unavailable. Try Git below.
  }

  try {
    const { stdout } = await execFile("git", [
      "-C",
      initialCwd,
      "rev-parse",
      "--show-toplevel",
    ]);

    const root = stdout.trim();

    if (root) return path.resolve(root);
  } catch {
    // Non-VCS directories keep their original cwd for existing review behavior.
  }

  return initialCwd;
}

function execFilePromise(
  file: "git" | "jj",
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string }> {
  return runVcs(file, args, options);
}
