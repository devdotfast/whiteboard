import path from "node:path";

import { jsonString } from "@dev.fast/review-protocol";

import { readBuildInfo } from "./package-paths";

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
