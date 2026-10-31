import { readFileSync } from "node:fs";

import { parseAgentTraceJsonl } from "./agent-trace-parser";
import {
  type NormalizedTrace,
  normalizedTracePath,
  writeNormalizedTraceAtomic,
} from "./trace-corpus";
import { findLocalTrace } from "./trace-local-sessions";
import { normalizeTrace } from "./trace-normalize";
import type { TraceRepo } from "./trace-repo";

/** Reads harness-owned files without publishing or consulting a remote store. */
export async function materializeLocalTrace(
  sessionId: string,
  traceName: string,
  repo: TraceRepo | null,
): Promise<NormalizedTrace | null> {
  const local = await findLocalTrace(sessionId);

  if (!local) return null;

  const file =
    traceName === "main"
      ? local.tracePath
      : local.subagentPaths.find((entry) => entry.name === `${traceName}.jsonl`)
          ?.path;

  if (!file) return null;
  const raw = readFileSync(file, "utf8");

  const parsed = parseAgentTraceJsonl(raw, {
    isSubagent: traceName !== "main",
  });

  const scope = repo ?? { owner: "local", repo: "sessions" };

  const normalized = normalizeTrace(parsed, {
    repository: `${scope.owner}/${scope.repo}`,
    sessionId,
    traceName,
    subagents: local.subagentPaths.map((entry) =>
      entry.name.replace(/\.jsonl$/, ""),
    ),
    source: {
      r2Key: "",
      bytes: Buffer.byteLength(raw),
      checkedAt: new Date().toISOString(),
      storage: "local",
    },
  });

  writeNormalizedTraceAtomic(
    normalizedTracePath(scope, sessionId, traceName),
    normalized,
  );

  return normalized;
}
