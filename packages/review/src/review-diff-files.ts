import {
  diff as readLocalVcsDiff,
  diffFileSummaries as readLocalVcsDiffFileSummaries,
  splitGitPatchFiles,
} from "@dev.fast/local-vcs";

export interface ReviewDiffFile {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ReviewDiffFilesResult {
  baseRef?: string;
  headRef?: string;
  files: ReviewDiffFile[];
}

export async function resolveReviewDiffFiles(input: {
  rootPath: string;
  baseRef?: string;
  headRef?: string;
  contextLines?: number;
  includePatch?: boolean;
  paths?: string[];
}): Promise<ReviewDiffFilesResult> {
  const baseRef = input.baseRef?.trim();

  if (!baseRef) return { files: [] };

  const headRef = input.headRef?.trim() || undefined;
  const paths = normalizeDiffPaths(input.paths);

  if (input.includePatch === false) {
    return {
      baseRef,
      headRef,
      files: await readLocalVcsDiffFileSummaries({
        rootPath: input.rootPath,
        baseRef,
        headRef,
        paths,
      }),
    };
  }

  const stdout = await readLocalVcsDiff({
    rootPath: input.rootPath,
    baseRef,
    headRef,
    paths,
    contextLines: input.contextLines,
  });

  return {
    baseRef,
    headRef,
    files: splitGitPatchFiles(stdout)
      .map(({ file, patch }) => ({
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch,
      }))
      .filter((file) => matchesDiffPath(file, paths)),
  };
}

function normalizeDiffPaths(paths: string[] | undefined): string[] {
  return [
    ...new Set(
      (paths ?? [])
        .map((path) => path.trim())
        .filter((path) => path.length > 0),
    ),
  ].sort();
}

function matchesDiffPath(file: ReviewDiffFile, paths: string[]): boolean {
  if (paths.length === 0) return true;
  const candidates = new Set([file.path, file.previousPath].filter(Boolean));

  return paths.some((path) => candidates.has(path));
}
