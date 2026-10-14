import { WelcomePage } from "@canvas/welcome-page";
import type {
  ReviewCanvasInstallContent,
  ReviewCanvasOnboarding,
  ReviewCanvasSetupActions,
} from "@dev.fast/review-protocol";

import { Onboarding } from "./onboarding";

export const REVIEW_ONBOARDING_SKIPPED_STORAGE_KEY =
  "dev.fast.review.onboardingSkipped";

export function readOnboardingSkipped(): boolean {
  try {
    return (
      globalThis.localStorage?.getItem(
        REVIEW_ONBOARDING_SKIPPED_STORAGE_KEY,
      ) === "1"
    );
  } catch {
    return false;
  }
}

export function writeOnboardingSkipped(skipped: boolean) {
  try {
    if (skipped)
      globalThis.localStorage?.setItem(
        REVIEW_ONBOARDING_SKIPPED_STORAGE_KEY,
        "1",
      );
    else
      globalThis.localStorage?.removeItem(
        REVIEW_ONBOARDING_SKIPPED_STORAGE_KEY,
      );
  } catch {
    // The desktop can disable DOM storage; skipping then lasts this session.
  }
}

/**
 * New installs get the full-window onboarding. An update that still has old
 * skills to remove, or one this build marks, keeps the migration rail.
 */
export function FirstRun({
  install,
  setupActions,
  onboarding,
  onSkip,
  onClose,
  onDismissUpdate,
}: {
  install?: ReviewCanvasInstallContent;
  setupActions?: ReviewCanvasSetupActions;
  onboarding?: ReviewCanvasOnboarding;
  onSkip(): void;
  /** The Welcome tab's close; Home has none. */
  onClose?(): void;
  onDismissUpdate?(): void;
}) {
  const migrating =
    install !== undefined &&
    (install.status.updateNeeded || install.status.legacySkills.length > 0);

  if (setupActions && !migrating)
    return (
      <Onboarding
        setupActions={setupActions}
        onSkip={() => {
          writeOnboardingSkipped(true);
          onSkip();
        }}
      />
    );

  return (
    <WelcomePage
      install={install}
      setupActions={setupActions}
      onClose={onClose}
      onDismissUpdate={onDismissUpdate}
      onboarding={onboarding}
    />
  );
}
