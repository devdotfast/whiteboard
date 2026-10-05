import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ReviewDesktopDiscovery } from "@dev.fast/review-protocol";
import { vi } from "vitest";

import {
  type ReviewInstanceSelection,
  isHealthyReviewDesktop,
} from "./desktop-discovery";

/**
 * One place for the filesystem scaffolding every Review test needs. Vitest runs
 * this package with `isolate: false` and `maxWorkers: 1`, so a stubbed env
 * variable outlives the file that set it: cleanupTempDirs unstubs as well as
 * deletes, and every suite that creates a directory here must call it.
 */
const trackedTempDirs: string[] = [];

export async function tempDir(prefix = "review-test-"): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  trackedTempDirs.push(dir);

  return dir;
}

export async function cleanupTempDirs(): Promise<void> {
  vi.unstubAllEnvs();
  await Promise.all(
    trackedTempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
}

export async function gitRepository(
  options: { initialBranch?: string } = {},
): Promise<string> {
  const root = await tempDir("review-test-source-");
  execFileSync(
    "git",
    ["-C", root, "init", "-b", options.initialBranch ?? "main"],
    { stdio: "pipe" },
  );

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });

  git("config", "user.email", "review@example.test");
  git("config", "user.name", "Review Test");
  await writeFile(path.join(root, "README.md"), "# Review\n", "utf8");
  git("add", ".");
  git("commit", "-m", "initial");

  return root;
}

export async function reviewHome(): Promise<string> {
  const home = await tempDir("review-test-home-");
  vi.stubEnv("DEV_REVIEW_HOME", home);

  return home;
}

/** A selection over one record read; health still comes from `fetch`, as in production. */
export function selectingDesktop(
  read: () => Promise<ReviewDesktopDiscovery | null>,
  fetch: typeof globalThis.fetch,
  base: Pick<ReviewInstanceSelection, "key" | "source"> = {
    key: "stable",
    source: "fallback",
  },
): () => Promise<ReviewInstanceSelection> {
  return async () => {
    let discovery: ReviewDesktopDiscovery | null;

    try {
      discovery = await read();
    } catch (error) {
      return {
        ...base,
        instances: [],
        problem: error instanceof Error ? error : new Error(String(error)),
      };
    }

    if (!discovery) return { ...base, instances: [] };

    const instance = {
      key: base.key,
      filePath: "",
      discovery,
      healthy: await isHealthyReviewDesktop(discovery, fetch),
    };

    return { ...base, instance, instances: [instance] };
  };
}
