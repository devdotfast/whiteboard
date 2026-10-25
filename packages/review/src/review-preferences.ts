import { readFile } from "node:fs/promises";
import path from "node:path";

import { isJsonObject, parseJsonText } from "@dev.fast/review-protocol";
import { writePrivateJsonAtomic } from "@dev.fast/trace-core";

import { devReviewHome } from "./review-home-paths";

/**
 * Machine-wide Review preferences the server itself needs. Workbench settings
 * do not work here: the review server never reads the workbench
 * configuration.
 */
function reviewPreferencesPath(devHome = devReviewHome()): string {
  return path.join(devHome, "preferences.json");
}

/** Whether agents are offered animation authoring; existing animations
 * always render. A missing or unreadable file means off; it never throws. */
export async function readAnimationsEnabled(
  devHome?: string,
): Promise<boolean> {
  try {
    const raw = parseJsonText(
      await readFile(reviewPreferencesPath(devHome), "utf8"),
    );

    return isJsonObject(raw) && raw.animationsEnabled === true;
  } catch {
    return false;
  }
}

export async function writeAnimationsEnabled(
  enabled: boolean,
  devHome?: string,
): Promise<boolean> {
  await writePrivateJsonAtomic(reviewPreferencesPath(devHome), {
    animationsEnabled: enabled,
  });

  return enabled;
}
