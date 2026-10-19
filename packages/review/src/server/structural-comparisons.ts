import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { git, gitCommonDir } from "@dev.fast/local-vcs";
import type { StructuralDiffEvent } from "@dev.fast/review-protocol";

import {
  type StructuralDiffRequest,
  structuralDiff,
} from "./structural-diff.js";

const IDLE_COMPARISONS = 10;

/** Replays a pinned comparison to concurrent rendering and coverage consumers. */
export class StructuralComparisons {
  private readonly entries = new Map<string, Comparison>();

  async *stream(
    input: StructuralDiffRequest,
  ): AsyncGenerator<StructuralDiffEvent> {
    input.signal.throwIfAborted();

    const key = JSON.stringify([
      configGeneration,
      await classificationStamp(input.repositoryPath),
      input.repositoryPath,
      input.comparison,
      input.paths,
    ]);

    let entry = this.entries.get(key);

    if (entry) this.entries.delete(key);
    else entry = new Comparison(input);
    this.entries.set(key, entry);

    entry.readers++;

    try {
      yield* entry.read(input.signal);
    } finally {
      entry.readers--;

      if (
        (!entry.done && !entry.initialReady && !entry.readers) ||
        entry.error ||
        entry.failed
      ) {
        entry.abort.abort();
        this.entries.delete(key);
      }
      // Keep the most recently read idle comparisons, including background enrichment.
      // Coverage can finish before an editor subscribes; it must not cancel summaries.

      const idle = [...this.entries].filter(
        ([, value]) => (value.done || value.initialReady) && !value.readers,
      );

      for (const [oldKey, old] of idle.slice(0, -IDLE_COMPARISONS)) {
        old.abort.abort();
        this.entries.delete(oldKey);
      }
    }
  }

  close(): void {
    for (const entry of this.entries.values()) entry.abort.abort();
    this.entries.clear();
  }
}

let configGeneration = 0;

const classificationFiles = new Map<string, Promise<string[]>>();

/** Git attribute and diffr config files that diffr's classifier reads. */
function classificationInputs(root: string): Promise<string[]> {
  let files = classificationFiles.get(root);

  if (!files) {
    const config =
      process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");

    const diffrDirectory =
      process.env.DIFFR_CONFIG_DIR || path.join(config, "diffr");

    files = Promise.all([
      gitCommonDir(root),
      git(root, ["config", "--path", "core.attributesFile"], {
        allowFailure: true,
      }),
    ]).then(([common, user]) => [
      ...(common ? [path.join(common, "info", "attributes")] : []),
      path.join(root, ".gitattributes"),
      user.stdout.trim() || path.join(config, "git", "attributes"),
      path.join(diffrDirectory, "config.toml"),
    ]);
    classificationFiles.set(root, files);
  }

  return files;
}

async function classificationStamp(root: string) {
  return Promise.all(
    (await classificationInputs(root)).map((file) =>
      stat(file).then(
        ({ mtimeMs, size }) => [mtimeMs, size],
        () => null,
      ),
    ),
  );
}

export function invalidateStructuralComparisons(): void {
  configGeneration++;
}

class Comparison {
  readonly abort = new AbortController();
  readonly events: StructuralDiffEvent[] = [];
  readers = 0;
  done = false;
  error: unknown;
  failed = false;
  initialReady = false;
  private remaining: Set<string> | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(input: StructuralDiffRequest) {
    void this.run(input);
  }

  private async run(input: StructuralDiffRequest): Promise<void> {
    try {
      for await (const event of structuralDiff({
        ...input,
        signal: this.abort.signal,
      })) {
        if (event.type === "start") {
          this.remaining = new Set(
            event.files.map(
              (entry) => (entry.file.rhs ?? entry.file.lhs)!.path,
            ),
          );
          this.initialReady = this.remaining.size === 0;
        } else if (event.type === "file") {
          const path = (event.file.rhs ?? event.file.lhs)!.path;

          if (!this.remaining?.delete(path))
            throw new Error(`Unexpected structural result: ${path}`);
          this.initialReady = this.remaining.size === 0;
        }

        if (event.type === "complete")
          this.failed = event.failed > 0 || !!event.aborted;
        this.events.push(event);

        for (const wake of this.listeners) wake();
      }
    } catch (error) {
      this.error = error;
    } finally {
      this.done = true;

      for (const wake of this.listeners) wake();
    }
  }

  async *read(signal: AbortSignal): AsyncGenerator<StructuralDiffEvent> {
    let index = 0;

    while (true) {
      signal.throwIfAborted();

      if (index < this.events.length) {
        yield this.events[index++];
        continue;
      }

      if (this.done) {
        if (this.error) throw this.error;

        return;
      }

      await new Promise<void>((resolve) => {
        const wake = () => {
          this.listeners.delete(wake);
          signal.removeEventListener("abort", wake);
          resolve();
        };

        this.listeners.add(wake);
        signal.addEventListener("abort", wake, { once: true });
      });
    }
  }
}
