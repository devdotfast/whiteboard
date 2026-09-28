import { readFileSync } from "node:fs";
import path from "node:path";

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
    const packageJson = jsonObject(
      parseJsonText(
        readFileSync(
          path.join(findReviewPackageRoot(moduleUrl), "package.json"),
          "utf8",
        ),
      ),
    );

    return jsonString(packageJson?.version) ?? "unknown";
  } catch {
    return "unknown";
  }
}
