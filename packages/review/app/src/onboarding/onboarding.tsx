import { railStepMarker } from "@canvas/markers.stylex";
import { space } from "@canvas/scale.stylex";
import { withClass } from "@canvas/stylex-props";
import { Button, buttonStyles } from "@canvas/ui/button";
import { Kbd } from "@canvas/ui/kbd";
import { textStyles } from "@canvas/ui/text";
import type { ReviewCanvasSetupActions } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";

import { DrawFlow, useOnboardingClient } from "./draw-flow";
import { InstallStep } from "./install-step";
import { onboardingStyles as styles } from "./onboarding-styles";
import { WelcomeStep } from "./welcome-step";

type Step = "welcome" | "install" | "run";

const RAIL: { step: Step; label: string }[] = [
  { step: "welcome", label: "Welcome" },
  { step: "install", label: "Install" },
  { step: "run", label: "Run" },
];

/**
 * First run, full window: welcome, connect every agent on the machine, then
 * draw a first whiteboard with one of them in the app. A published
 * whiteboard opens in its own tab and Home lists it, which ends first run.
 */
export function Onboarding({
  setupActions,
  onSkip,
}: {
  setupActions: ReviewCanvasSetupActions;
  /** Leaves first run for an empty Home. */
  onSkip(): void;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const { client, unavailable } = useOnboardingClient(setupActions);
  const [installProgress, setInstallProgress] = useState(0);
  // Run needs an agent with Whiteboard, which Install finds out.
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    client?.capture("onboarding_step_viewed", { step });
  }, [client, step]);

  const skip = useCallback(() => {
    client?.capture("onboarding_skipped", { step });
    onSkip();
  }, [client, onSkip, step]);

  // Escape leaves for Home, unless a field or menu has it.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;

      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        target?.closest(
          "textarea, input, select, [contenteditable], [role=menu]",
        )
      )
        return;
      skip();
    };

    window.addEventListener("keydown", keydown);

    return () => window.removeEventListener("keydown", keydown);
  }, [skip]);

  const current = RAIL.findIndex((rail) => rail.step === step);

  const fill = (index: number) => {
    if (index < current) return 1;

    if (index > current) return 0;

    return step === "install" ? installProgress : 0.2;
  };

  return (
    <main {...withClass("review-onboarding", styles.page)}>
      <nav {...stylex.props(styles.rail)} aria-label="Setup">
        <span {...stylex.props(styles.railSide)} />
        <ol {...stylex.props(styles.railSteps)}>
          {RAIL.map(({ step: target, label }, index) => (
            <li key={label}>
              <button
                type="button"
                {...stylex.props(
                  railStepMarker,
                  buttonStyles.reset,
                  styles.railStep,
                )}
                aria-current={index === current ? "step" : undefined}
                disabled={target === "run" && !connected && step !== "run"}
                onClick={() => setStep(target)}
              >
                <span {...stylex.props(styles.railTrack)}>
                  <span
                    {...stylex.props(styles.railFill)}
                    style={{ transform: `scaleX(${fill(index)})` }}
                  />
                </span>
                <span
                  {...stylex.props(
                    styles.railLabel,
                    index === current && styles.railLabelCurrent,
                  )}
                >
                  {label}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <span {...stylex.props(styles.railSide)}>
          <Button xstyle={railStyles.skip} onClick={skip}>
            Skip to Home
            <Kbd>esc</Kbd>
          </Button>
        </span>
      </nav>

      {unavailable ? (
        <p
          role="alert"
          {...stylex.props(textStyles.error, styles.error, styles.stage)}
        >
          Whiteboard could not reach its server: {unavailable}
        </p>
      ) : step === "welcome" ? (
        <WelcomeStep key="welcome" onStart={() => setStep("install")} />
      ) : !client ? null : step === "install" ? (
        <InstallStep
          key="install"
          client={client}
          setupActions={setupActions}
          onProgress={setInstallProgress}
          onConnected={setConnected}
          onContinue={() => setStep("run")}
        />
      ) : (
        <DrawFlow
          client={client}
          onRunStarted={(mode, agent) =>
            client.capture("onboarding_run_started", {
              mode,
              ...(agent && { agent }),
            })
          }
          setupActions={setupActions}
          intro={{
            heading: "Draw your first whiteboard.",
            lead: "Pick a branch, worktree or pull request. Draw it with an agent right here, or copy the prompt into your own.",
          }}
        />
      )}
    </main>
  );
}

const railStyles = stylex.create({
  skip: { gap: space.s10, paddingInlineEnd: space.s8 },
});
