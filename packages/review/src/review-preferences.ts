import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  type JsonValue,
  isJsonObject,
  parseJsonText,
} from "@dev.fast/review-protocol";
import { writePrivateJsonAtomic } from "@dev.fast/trace-core";

import { devReviewHome } from "./review-home-paths";

/**
 * Machine-wide Review preferences the server itself needs. Workbench settings
 * do not work here: the review server never reads the workbench
 * configuration.
 */
export interface ReviewPreferences {
  /**
   * Whether the scratchpad exists on this machine. Off, the server neither
   * makes nor lists it and Review's instructions do not offer it to agents.
   */
  scratchpadEnabled: boolean;
  /** Offer animation authoring to agents; existing animations always render. */
  animationsEnabled: boolean;
}

const DEFAULT_REVIEW_PREFERENCES: ReviewPreferences = {
  scratchpadEnabled: false,
  animationsEnabled: false,
};

function reviewPreferencesPath(devHome = devReviewHome()): string {
  return path.join(devHome, "preferences.json");
}

/** A missing or unreadable file falls back to the defaults; it never throws. */
export async function readReviewPreferences(
  devHome?: string,
): Promise<ReviewPreferences> {
  try {
    const raw = parseJsonText(
      await readFile(reviewPreferencesPath(devHome), "utf8"),
    );

    return {
      scratchpadEnabled: parseScratchpadEnabled(raw),
      animationsEnabled: isJsonObject(raw) && raw.animationsEnabled === true,
    };
  } catch {
    return { ...DEFAULT_REVIEW_PREFERENCES };
  }
}

export async function writeReviewPreferences(
  preferences: ReviewPreferences,
  devHome?: string,
): Promise<ReviewPreferences> {
  const next: ReviewPreferences = {
    scratchpadEnabled: preferences.scratchpadEnabled === true,
    animationsEnabled: preferences.animationsEnabled === true,
  };

  await writePrivateJsonAtomic(reviewPreferencesPath(devHome), next);

  return next;
}

/** Reads the scratchpad preference; a missing file means off. */
export async function readScratchpadEnabled(
  devHome?: string,
): Promise<boolean> {
  return (await readReviewPreferences(devHome)).scratchpadEnabled;
}

/** Sets the scratchpad preference, keeping the other preferences as they are. */
export async function writeScratchpadEnabled(
  enabled: boolean,
  devHome?: string,
): Promise<boolean> {
  const current = await readReviewPreferences(devHome);

  return (
    await writeReviewPreferences(
      { ...current, scratchpadEnabled: enabled },
      devHome,
    )
  ).scratchpadEnabled;
}

function parseScratchpadEnabled(raw: JsonValue): boolean {
  return isJsonObject(raw) && raw.scratchpadEnabled === true;
}

export async function writeAnimationsEnabled(
  enabled: boolean,
  devHome?: string,
): Promise<boolean> {
  const current = await readReviewPreferences(devHome);

  return (
    await writeReviewPreferences(
      { ...current, animationsEnabled: enabled },
      devHome,
    )
  ).animationsEnabled;
}
