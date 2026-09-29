import { readFileSync } from "node:fs";
import path from "node:path";

import {
  jsonObject,
  jsonString,
  parseJsonText,
} from "@dev.fast/review-protocol";

/** `build-info.json` in a built package's `dist`, when present. */
export function readBuildInfo(distDirectory: string) {
  try {
    return jsonObject(
      parseJsonText(
        readFileSync(path.join(distDirectory, "build-info.json"), "utf8"),
      ),
    );
  } catch {
    return undefined;
  }
}

/** Build identity belongs to the executable, never the current checkout. */
export function cliRuntimeInfo(
  requestedPath: string,
  effectivePath = requestedPath,
) {
  const metadata = readBuildInfo(path.dirname(effectivePath));

  return {
    event: "version" as const,
    requestedPath,
    effectivePath,
    delegated: requestedPath !== effectivePath,
    version: jsonString(metadata?.version) ?? null,
    commit: jsonString(metadata?.commit) ?? null,
    dirty:
      metadata?.dirty === true
        ? true
        : metadata?.dirty === false
          ? false
          : null,
    builtAt: jsonString(metadata?.builtAt) ?? null,
  };
}

export function describeCliRuntime(
  info: ReturnType<typeof cliRuntimeInfo>,
): string {
  return `CLI: ${info.effectivePath}${info.delegated ? ` (delegated from ${info.requestedPath})` : " (direct)"}\nBuild: ${info.version ?? "unknown"}, commit ${info.commit ?? "unknown"}, dirty ${info.dirty ?? "unknown"}, built ${info.builtAt ?? "unknown"}\n`;
}
