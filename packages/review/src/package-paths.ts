import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { jsonObject, jsonString, parseJsonText } from "@dev.fast/json";
import { findPackageRoot } from "@dev.fast/trace-core";

export function findReviewPackageRoot(
  moduleUrl: string = import.meta.url,
): string {
  return findPackageRoot(moduleUrl);
}

export function readReviewPackageVersion(
  moduleUrl: string = import.meta.url,
): string {
  try {
    const root = findReviewPackageRoot(moduleUrl);

    const { DEV_FAST_REVIEW_CHECKOUT, DEV_FAST_REVIEW_DEV_VERSION } =
      process.env;

    // run.sh: a dev Desktop's version names its checkout's state.
    if (
      DEV_FAST_REVIEW_DEV_VERSION &&
      DEV_FAST_REVIEW_CHECKOUT &&
      root === path.join(DEV_FAST_REVIEW_CHECKOUT, "packages", "review")
    )
      return DEV_FAST_REVIEW_DEV_VERSION;

    const packageJson = jsonObject(
      parseJsonText(readFileSync(path.join(root, "package.json"), "utf8")),
    );

    return jsonString(packageJson?.version) ?? "unknown";
  } catch {
    return "unknown";
  }
}

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

/** The build's commit; null from source, where an old `dist` may linger. */
export function readBuildCommit(moduleUrl: string): string | null {
  const dist = path.join(findReviewPackageRoot(moduleUrl), "dist");

  if (!fileURLToPath(moduleUrl).startsWith(`${dist}${path.sep}`)) return null;

  return jsonString(readBuildInfo(dist)?.commit) ?? null;
}
