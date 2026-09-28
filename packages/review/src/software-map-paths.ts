import path from "node:path";

/** dev.fast's private directory inside a repo's shared git dir. */
export function devFastGitDir(gitCommonDir: string): string {
  return path.join(gitCommonDir, "dev-fast");
}
