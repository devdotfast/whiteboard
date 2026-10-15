import { useNotify } from "@canvas/notify";
import { copyText } from "@canvas/ui/copy";
import type { ReviewCanvasSetupActions } from "@dev.fast/review-protocol";
import { useCallback, useEffect, useState } from "react";

import { OnboardingClient } from "./onboarding-client";
import { RunStep, type StepIntro } from "./run-step";

/** The Desktop server's client, once its connection resolves. */
export function useOnboardingClient(setupActions: ReviewCanvasSetupActions) {
  const [client, setClient] = useState<OnboardingClient>();
  const [unavailable, setUnavailable] = useState<string>();

  useEffect(() => {
    let live = true;

    setupActions.connection().then(
      (connection) => live && setClient(new OnboardingClient(connection)),
      (cause: unknown) =>
        live &&
        setUnavailable(cause instanceof Error ? cause.message : String(cause)),
    );

    return () => {
      live = false;
    };
  }, [setupActions]);

  return { client, unavailable };
}

/** Choosing what to draw, then drawing it with an agent here, which opens the
 * whiteboard with the agent at work in its Ask panel, or pasting the prompt
 * into an agent of the reader's own: first run's last step, and Home's New
 * whiteboard. */
export function DrawFlow({
  client,
  setupActions,
  intro,
  embedded,
  onStarted,
  onCopied,
}: {
  client: OnboardingClient;
  setupActions: ReviewCanvasSetupActions;
  intro?: StepIntro;
  embedded?: boolean;
  onStarted?(reviewId: string): void;
  onCopied?(): void;
}) {
  const notify = useNotify();

  // The reader's own agent draws it; the whiteboard opens here once it does.
  const copy = useCallback(
    async (prompt: string) => {
      const copied = await copyText(prompt);

      if (copied) onCopied?.();

      notify(
        copied
          ? {
              kind: "success",
              text: "Prompt copied. Paste it into your agent.",
            }
          : {
              kind: "error",
              text: "Couldn't copy the prompt. Please try again.",
            },
      );
    },
    [notify, onCopied],
  );

  return (
    <RunStep
      client={client}
      setupActions={setupActions}
      intro={intro}
      embedded={embedded}
      onStarted={onStarted}
      onCopy={(prompt) => void copy(prompt)}
    />
  );
}
