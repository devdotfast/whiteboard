import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { sessionIdSchema } from "@dev.fast/trace-protocol";
import { z } from "zod";

import { listFilesRecursive } from "./trace-corpus";
import { codexSessionsRoot, traceEnvValue } from "./trace-local-sessions";

const location = z.object({
  cwd: z.string(),
  sessionId: z.string().optional(),
  id: z.string().optional(),
});

const sessionRecord = z.union([
  z
    .object({ type: z.literal("session_meta"), payload: location })
    .transform((record) => record.payload),
  location,
]);

/** Discover only transcripts belonging to this working directory, without hooks or a store. */
export async function listLocalTraceSessionIds(cwd: string): Promise<string[]> {
  const roots = [
    traceEnvValue("TRACE_LOCAL_TRACE_ROOT") ||
      path.join(homedir(), ".claude", "projects"),
    codexSessionsRoot(),
    traceEnvValue("TRACE_PI_SESSIONS_ROOT") ||
      path.join(homedir(), ".pi", "agent", "sessions"),
  ];

  const sessions = new Set<string>();

  for (const root of roots) {
    for (const file of listFilesRecursive(root)) {
      if (!file.endsWith(".jsonl")) continue;
      const id = await sessionInDirectory(file, cwd);

      if (id) sessions.add(id);
    }
  }

  return [...sessions].sort();
}

async function sessionInDirectory(
  file: string,
  cwd: string,
): Promise<string | null> {
  // Metadata occurs at the start; bound reads even for large or malformed transcripts.
  const stream = createReadStream(file, { encoding: "utf8", end: 65535 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      const record = parseLocation(line);

      if (!record) continue;

      if (path.resolve(record.cwd) !== path.resolve(cwd)) return null;
      const id = sessionIdSchema.safeParse(record.sessionId ?? record.id);

      if (id.success) return id.data;
    }
  } catch {
    // A transcript may be removed or rotated while discovery is running.
  } finally {
    lines.close();
    stream.destroy();
  }

  return null;
}

function parseLocation(line: string): z.infer<typeof location> | null {
  try {
    const parsed = sessionRecord.safeParse(JSON.parse(line));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
