import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  STRUCTURAL_DIFF_WIRE_VERSION,
  type StructuralDiffEvent,
  type StructuralProblem,
  decodeStructuralDiffEvent,
  ndjsonRecords,
} from "@dev.fast/review-protocol";
import { findReviewPackageRoot } from "@review/package-paths";

import { installedFullDiffr } from "./diffr-languages.js";

export type DiffComparison =
  | { kind: "trees"; base: string; head: string }
  | { kind: "merge-base"; base: string; head: string }
  // The revision separates cached streams after a working-file save.
  | { kind: "worktree"; base: string; revision: string };

export interface StructuralDiffRequest {
  repositoryPath: string;
  comparison: DiffComparison;
  paths?: readonly string[];
  signal: AbortSignal;
}

export function diffrExecutable(
  packageRoot = findReviewPackageRoot(import.meta.url),
): string {
  if (process.env.REVIEW_DIFFR_BINARY) return process.env.REVIEW_DIFFR_BINARY;

  const full = installedFullDiffr(packageRoot);

  if (full) return full;

  const bundled = path.join(
    packageRoot,
    "bin",
    process.platform === "win32" ? "diffr.exe" : "diffr",
  );

  return existsSync(bundled) ? bundled : "diffr";
}

export function diffrMissingError(): Error {
  return new Error(
    `Cannot find diffr at ${diffrExecutable()}. Whiteboard Desktop bundles it at bin/diffr under its runtime; in a checkout, run \`pnpm --filter @dev.fast/whiteboard ensure:diffr\` or install diffr on PATH, or set REVIEW_DIFFR_BINARY to its executable.`,
  );
}

/**
 * Stream validated diffr records. File errors and aborted completion are data;
 * launch failures, malformed/truncated streams and unexpected exits throw.
 * Closing the iterator (including a consumer's break) terminates the child.
 */
export async function* structuralDiff(
  input: StructuralDiffRequest,
): AsyncGenerator<StructuralDiffEvent> {
  input.signal.throwIfAborted();
  const comparison = input.comparison;

  const args = [
    "--repo",
    input.repositoryPath,
    "--format",
    "ndjson",
    "--stream-annotations",
  ];

  switch (comparison.kind) {
    case "worktree":
      args.push(comparison.base);
      break;
    case "trees":
      args.push(comparison.base, comparison.head);
      break;
    case "merge-base":
      args.push(`${comparison.base}...${comparison.head}`);
  }

  args.push("--", ...(input.paths ?? []));

  const idleAbort = new AbortController();
  const idle = setTimeout(() => idleAbort.abort(), 120_000);
  const signal = AbortSignal.any([idleAbort.signal, input.signal]);

  // The host inherits its own environment and runs from the repository, so
  // diffr reads the user's config and keys exactly as it would from a shell.
  console.info(
    `[Review] structural diff: ${diffrExecutable()} ${args.join(" ")}`,
  );

  const child = spawn(diffrExecutable(), args, {
    cwd: input.repositoryPath,
    stdio: ["ignore", "pipe", "pipe"],
    signal,
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-16_384);
  });

  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" ? diffrMissingError() : error);
    });
    child.once("close", (code) => resolve(code));
  });

  const exitError = (code: number | null) =>
    new Error(`diffr exited with ${code}: ${stderr}`);

  // Observe process errors immediately, including before stdout closes.
  void exited.catch(() => {});
  let started = false;
  let completed = false;
  let aborted: StructuralProblem | undefined;
  let failed = 0;
  let annotationFailed = false;

  try {
    for await (const line of ndjsonRecords(child.stdout, RECORD_LIMIT)) {
      // Large comparisons may take minutes while continuing to make progress.
      idle.refresh();

      if (!line.trim()) continue;
      const event = decodeStructuralDiffEvent(line);

      if (completed) throw new Error("diffr emitted data after completion.");

      if (!started) {
        if (
          event.type !== "start" ||
          event.version !== STRUCTURAL_DIFF_WIRE_VERSION
        ) {
          throw new Error("Unsupported diffr stream protocol.");
        }

        started = true;
      } else if (event.type === "complete") {
        completed = true;

        failed = event.failed;
        aborted = event.aborted;
      } else if (event.type === "annotations") {
        annotationFailed ||= event.error !== undefined;
      } else if (event.type !== "file") {
        throw new Error(`Unexpected diffr event: ${event.type}`);
      }

      yield event;
    }

    if (!completed) {
      const code = await exited;

      if (code !== 0) throw exitError(code);
      throw new Error("diffr stream ended before completion.");
    }

    // diffr exits 2 for file or enrichment failures already reported by the stream.
    const code = await exited;

    if (
      code !== 0 &&
      !(code === 2 && (failed > 0 || annotationFailed || aborted !== undefined))
    )
      throw exitError(code);
  } finally {
    clearTimeout(idle);

    if (child.exitCode === null) child.kill();
    await exited.catch(() => {});
  }
}

// Bound individual records, not the entire streamed comparison: a
// directory move can legitimately contain thousands of small files.
const RECORD_LIMIT = {
  bytes: 64 * 1024 * 1024,
  message: "Structural diff record exceeded 64 MiB.",
};
