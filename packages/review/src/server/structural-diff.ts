import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { diffrBinaryPath } from "@dev.fast/diffr";
import {
  STRUCTURAL_DIFF_WIRE_VERSION,
  type StructuralDiffEvent,
  type StructuralProblem,
  decodeStructuralDiffEvent,
} from "@dev.fast/review-protocol";

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

export function diffrExecutable(): string {
  const executable = diffrBinaryPath();

  if (!executable) throw diffrMissingError();

  return executable;
}

export function diffrMissingError(): Error {
  return new Error(
    "The bundled diffr executable is missing. Reinstall Whiteboard.",
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
  const executable = diffrExecutable();
  const comparison = input.comparison;

  const args = ["--repo", input.repositoryPath, "--format", "ndjson"];

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

  // Plugins can exceed two minutes between records. Apply this timeout only
  // until the manifest arrives; plugins enforce their own request timeouts.
  const startupAbort = new AbortController();
  const startup = setTimeout(() => startupAbort.abort(), 120_000);
  const signal = AbortSignal.any([startupAbort.signal, input.signal]);

  // The host inherits its own environment and runs from the repository, so
  // diffr reads the user's config and keys exactly as it would from a shell.
  console.info(`[Review] structural diff: ${executable} ${args.join(" ")}`);

  const child = spawn(executable, args, {
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
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      // Bound individual records, not the entire streamed comparison: a
      // directory move can legitimately contain thousands of small files.
      // Generated parsers in diffr can exceed 64 MiB after JSON encoding.
      if (Buffer.byteLength(line) > 96 * 1024 * 1024)
        throw new Error("Structural diff record exceeded 96 MiB.");

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
        clearTimeout(startup);
      } else if (event.type === "complete") {
        completed = true;

        failed = event.failed;
        aborted = event.aborted;
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

    // diffr exits 2 for file failures already reported by the stream.
    const code = await exited;

    if (code !== 0 && !(code === 2 && (failed > 0 || aborted !== undefined)))
      throw exitError(code);
  } finally {
    clearTimeout(startup);
    lines.close();

    if (child.exitCode === null) child.kill();
    await exited.catch(() => {});
  }
}
