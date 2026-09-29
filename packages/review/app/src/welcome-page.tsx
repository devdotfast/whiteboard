import { Button } from "@canvas/ui/button";
import { EmptyState } from "@canvas/ui/empty-state";
import { textStyles } from "@canvas/ui/text";
import {
  REVIEW_DISCORD_URL,
  type ReviewCanvasInstallContent,
  type ReviewCanvasOnboarding,
  type ReviewCanvasSetupActions,
  type ReviewCliInstallStatus,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useState } from "react";

import { cliInstallReady } from "./cli-install-status";
import { ConnectCard, LegacySkillsRow } from "./connect-card";
import { homeStyles } from "./home-styles";
import { DisclosureChevron, DrawnCheckIcon } from "./icons";
import { newTabLinkProps } from "./link-props";
import { chevronMarker } from "./markers.stylex";
import { PromptCard } from "./prompt-card";
import { promptStyles } from "./prompt-styles";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";

export const REVIEW_CONNECT_COPIED_STORAGE_KEY =
  "dev.fast.review.connectCopied";

/** Long enough for a finished step's check to draw before the next opens. */
export const STEP_ADVANCE_DELAY_MS = 900;

/** First-run setup and migration from legacy agent skills to MCP. */
export function WelcomePage({
  install: initialInstall,
  setupActions,
  onClose,
  onDismissUpdate,
  onboarding,
  onOpenTutorial,
}: {
  install?: ReviewCanvasInstallContent;
  setupActions?: ReviewCanvasSetupActions;
  onClose?: () => void;
  onDismissUpdate?: () => void;
  onboarding?: ReviewCanvasOnboarding;
  onOpenTutorial?: () => void;
}) {
  const [loadedInstall, setLoadedInstall] =
    useState<ReviewCanvasInstallContent>();

  const [setupError, setSetupError] = useState<string>();
  const [setupBusy, setSetupBusy] = useState(false);
  const install = loadedInstall ?? initialInstall;

  const runSetup = async (action: () => Promise<void>) => {
    setSetupBusy(true);
    setSetupError(undefined);

    try {
      await action();
    } catch (cause) {
      setSetupError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSetupBusy(false);
    }
  };

  /* The host renders this pane once per open, so an action taken while it is
     on screen has to advance the rail itself. Each action hands back the
     refreshed status; until the first one, the host's copy is correct. */
  const [cardStatus, setCardStatus] = useState<
    ReviewCliInstallStatus | undefined
  >(undefined);

  const status = cardStatus ?? install?.status;

  // The step a button just finished stays open while its check draws, then
  // hands over to the next one unless the reader opened another meanwhile.
  const [finishing, setFinishing] = useState<{ from: string; to?: string }>();

  useEffect(() => {
    if (!finishing) return;

    const timer = setTimeout(() => {
      setFinishing(undefined);
      setOpenStep((current) =>
        current === finishing.from ? finishing.to : current,
      );
    }, STEP_ADVANCE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [finishing]);

  const refreshInstall = async () => {
    if (!setupActions) return;
    const next = await setupActions.load();
    setLoadedInstall(next);

    if (cliInstallReady(next.status) && next.status.legacySkills.length === 0)
      setFinishing({
        from: "Install the whiteboard command",
        to: "Connect your agents",
      });
    setCardStatus(undefined);
  };

  const installed = cliInstallReady(status);
  const cliBuildMissing = status?.cli === null && !installed;

  const hasLegacySkills = (status?.legacySkills.length ?? 0) > 0;
  const setupReady = installed && !hasLegacySkills;
  // Once shown, the removal step stays, even if an agent following the
  // connect prompt deletes the skills first.
  const [showLegacyStep, setShowLegacyStep] = useState(hasLegacySkills);
  const updating = (status?.updateNeeded ?? false) || showLegacyStep;

  if (hasLegacySkills && !showLegacyStep) setShowLegacyStep(true);

  const [replaceInstallStep, setReplaceInstallStep] = useState(
    () => installed && hasLegacySkills,
  );

  if (installed && hasLegacySkills && !replaceInstallStep)
    setReplaceInstallStep(true);

  // Whiteboard cannot see agent configs, so a copied prompt or command is the
  // closest signal that an agent got connected.
  const [connectCopied, setConnectCopied] = useState(readConnectCopied);
  const [updateFinished, setUpdateFinished] = useState(false);
  const [connectOpened, setConnectOpened] = useState(false);
  const canDismiss = setupReady && connectOpened;

  const markConnectCopied = () => {
    setConnectCopied(true);
    setFinishing({
      from: "Connect your agents",
      to: updating ? "Continue shipping thoughtful code" : "Take the tour",
    });

    try {
      globalThis.localStorage?.setItem(REVIEW_CONNECT_COPIED_STORAGE_KEY, "1");
    } catch {
      // The desktop can disable DOM storage; the in-memory flag still works.
    }
  };

  const tourChecked = onboarding?.tutorialChecked ?? 0;
  const tourTotal = onboarding?.tutorialTotal ?? 0;

  const installDone = finishing?.from === "Install the whiteboard command";

  const installOffered =
    setupActions !== undefined && !installed && !cliBuildMissing;

  const installStep: WelcomeStep = {
    title: "Install the whiteboard command",
    disabled: hasLegacySkills,
    done: installed,
    body: (
      <>
        <p {...stylex.props(styles.hint)}>
          {installed ? (
            `Installed at ${status?.shim.path ?? "~/.local/bin/whiteboard"}.`
          ) : cliBuildMissing ? (
            <>
              CLI build missing. If you’re running from source, run{" "}
              <code {...stylex.props(styles.hintCode)}>
                pnpm --filter @dev.fast/review build
              </code>{" "}
              from the repository root, then restart Whiteboard. Otherwise,
              reinstall Whiteboard.
            </>
          ) : status?.shim.installed ? (
            pathHint(status.shim.path)
          ) : (
            <>
              The <code {...stylex.props(styles.hintCode)}>whiteboard</code> CLI
              lets your agents talk to Whiteboard
            </>
          )}
        </p>
        {installDone ? <StepDoneButton label="Installed" primary /> : null}
        {installOffered ? (
          <Button
            variant="primary"
            size="large"
            xstyle={[styles.stepButton, installDone && styles.stepButtonNext]}
            disabled={setupBusy}
            onClick={() =>
              void runSetup(async () => {
                await setupActions.installCli();
                await refreshInstall();
              })
            }
          >
            Install whiteboard in PATH
          </Button>
        ) : null}
        {setupActions &&
        (!install ||
          cliBuildMissing ||
          (status?.shim.installed && !installed)) ? (
          <Button
            size="large"
            xstyle={[
              styles.stepButton,
              (installDone || installOffered) && styles.stepButtonNext,
            ]}
            disabled={setupBusy}
            onClick={() => void runSetup(refreshInstall)}
          >
            {setupBusy ? "Refreshing…" : "Refresh"}
          </Button>
        ) : null}
        {setupError ? (
          <p role="alert" {...stylex.props(promptStyles.error)}>
            {setupError}
          </p>
        ) : null}
      </>
    ),
  };

  const dismissUpdate = () => {
    if (!install || !canDismiss) return;
    void runSetup(async () => {
      setCardStatus(await install.finishUpdate());
      setUpdateFinished(true);
      (onDismissUpdate ?? onClose)?.();
    });
  };

  const steps: WelcomeStep[] = [
    ...(showLegacyStep && install && status
      ? [
          {
            title: "Remove deprecated skills",
            done: !hasLegacySkills,
            label: hasLegacySkills
              ? undefined
              : "Deprecated skills removed successfully",
            body:
              finishing?.from === "Remove deprecated skills" ? (
                <StepDoneButton label="Removed" />
              ) : !hasLegacySkills ? (
                <p role="status">Deprecated skills removed successfully</p>
              ) : (
                <LegacySkillsRow
                  install={{ ...install, status }}
                  onStatusChange={(next) => {
                    setCardStatus(next);

                    if (next.legacySkills.length === 0)
                      setFinishing({
                        from: "Remove deprecated skills",
                        to: cliInstallReady(next)
                          ? "Connect your agents"
                          : "Install the whiteboard command",
                      });
                  }}
                />
              ),
          },
        ]
      : []),
    ...(replaceInstallStep && installed ? [] : [installStep]),
    {
      title: "Connect your agents",
      disabled: !setupReady,
      done: connectCopied || updateFinished,
      note: "paste a prompt into each agent",
      body:
        install && status ? (
          <ConnectCard
            install={{ ...install, status }}
            onCopied={markConnectCopied}
          />
        ) : (
          <EmptyState message="Agent setup is unavailable." />
        ),
    },
  ];

  if ((updating || showLegacyStep) && install)
    steps.push({
      title: "Continue shipping thoughtful code",
      disabled: !canDismiss,
      done: updateFinished,
      body: (
        <Button
          variant="primary"
          size="large"
          xstyle={styles.dismiss}
          disabled={setupBusy || !canDismiss}
          onClick={dismissUpdate}
        >
          Dismiss
        </Button>
      ),
    });

  if (!updating && !showLegacyStep)
    steps.push(
      {
        title: "Take the tour",
        disabled: !setupReady,
        done: tourTotal > 0 && tourChecked >= tourTotal,
        note: onboarding
          ? `${tourChecked} of ${tourTotal} checks`
          : "a three-minute sample session",
        body: (
          <>
            <p {...stylex.props(styles.hint)}>
              Explore a sample session in three minutes.
            </p>
            {onOpenTutorial ? (
              <Button
                size="large"
                xstyle={styles.stepButton}
                onClick={onOpenTutorial}
              >
                {tourChecked > 0 ? "Reopen the tutorial" : "Open the tutorial"}
              </Button>
            ) : null}
          </>
        ),
      },
      {
        title: "Create your first session",
        disabled: !setupReady,
        done: onboarding?.published ?? false,
        note: onboarding?.published ? "published" : "your agent writes it",
        body: <PromptCard />,
      },
    );

  // Keep step identity stable as status and completion labels change.
  const [openStep, setOpenStep] = useState(() =>
    updating && installed && !hasLegacySkills
      ? "Connect your agents"
      : steps.find((step) => !step.done)?.title,
  );

  if (openStep && !steps.some((step) => step.title === openStep))
    setOpenStep(steps.find((step) => !step.done && !step.disabled)?.title);

  if (openStep === "Connect your agents" && setupReady && !connectOpened)
    setConnectOpened(true);

  return (
    <main {...withClass("review-home", homeStyles.page)}>
      <div {...stylex.props(homeStyles.scroll)}>
        <div {...stylex.props(homeStyles.content, styles.page)}>
          <div {...stylex.props(styles.columns)}>
            <div {...stylex.props(styles.intro)}>
              <span {...stylex.props(textStyles.eyebrow, styles.kicker)}>
                Welcome to Whiteboard
              </span>
              {updating ? (
                <>
                  <h1
                    {...withClass(
                      "review-onboarding-headline",
                      styles.headline,
                    )}
                  >
                    Whiteboard now connects to your agents over MCP
                  </h1>
                  <p {...stylex.props(styles.sub)}>
                    Whiteboard (fka. Review) no longer installs skills. Your
                    agents connect via MCP which makes updating and lifecycle
                    simpler! To continue using Whiteboard, axe the skills,
                    install the plugin in your harness of choice, and you're
                    good to go.
                  </p>
                </>
              ) : (
                <>
                  <h1
                    {...withClass(
                      "review-onboarding-headline",
                      styles.headline,
                    )}
                  >
                    Your codebase, explained by your agent.
                  </h1>
                  <p {...stylex.props(styles.sub)}>
                    Install the command then setup the MCP to get started.
                  </p>
                </>
              )}
              {(updating || showLegacyStep) && install ? (
                <Button
                  xstyle={styles.dismiss}
                  disabled={setupBusy || !canDismiss}
                  onClick={dismissUpdate}
                >
                  Dismiss
                </Button>
              ) : onClose ? (
                <Button
                  xstyle={styles.dismiss}
                  disabled={setupBusy || !canDismiss}
                  onClick={onClose}
                >
                  Close
                </Button>
              ) : null}
            </div>
            <ol {...stylex.props(styles.steps)}>
              {steps.map((step, index) => {
                const open = openStep === step.title && !step.disabled;

                return (
                  <li
                    key={step.title}
                    {...stylex.props(styles.step, open && styles.stepOpen)}
                    data-state={step.done ? "done" : "todo"}
                    data-open={open}
                  >
                    <button
                      type="button"
                      {...stylex.props(chevronMarker, styles.stepHeader)}
                      disabled={step.disabled}
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} ${step.label ?? step.title}`}
                      onClick={() => setOpenStep(open ? undefined : step.title)}
                    >
                      <StepBadge
                        done={step.done}
                        open={open}
                        label={String(index + 1)}
                      />
                      <span
                        {...stylex.props(
                          styles.stepTitle,
                          step.done && !open && styles.stepTitleDone,
                        )}
                      >
                        {step.label ?? step.title}
                      </span>
                      {step.note ? (
                        <span {...stylex.props(styles.stepNote)}>
                          {step.note}
                        </span>
                      ) : null}
                      <DisclosureChevron
                        expanded={open}
                        xstyle={styles.stepChevron}
                      />
                    </button>
                    {open ? (
                      <div {...stylex.props(styles.stepBody)}>{step.body}</div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
          <p {...stylex.props(styles.feedback)}>
            {updating || showLegacyStep
              ? "Thoughts on the rename or product direction?"
              : "Questions about getting started? Suggestions for new features?"}{" "}
            Ask us on{" "}
            <a
              {...stylex.props(styles.feedbackLink)}
              href={REVIEW_DISCORD_URL}
              {...newTabLinkProps(REVIEW_DISCORD_URL)}
            >
              Discord
            </a>{" "}
            or ping us at{" "}
            <a
              {...stylex.props(styles.feedbackLink)}
              href="mailto:founders@dev.fast"
            >
              founders@dev.fast
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}

function readConnectCopied(): boolean {
  try {
    return (
      globalThis.localStorage?.getItem(REVIEW_CONNECT_COPIED_STORAGE_KEY) ===
      "1"
    );
  } catch {
    return false;
  }
}

interface WelcomeStep {
  title: string;
  label?: string;
  done: boolean;
  disabled?: boolean;
  note?: string;
  body: ReactNode;
}

/** The button that finished a step, held while its check draws. */
function StepDoneButton({
  label,
  primary,
}: {
  label: string;
  primary?: boolean;
}) {
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      size="large"
      xstyle={[styles.stepButton, styles.stepDone]}
      disabled
    >
      <DrawnCheckIcon />
      {label}
    </Button>
  );
}

function StepBadge({
  done,
  open,
  label,
}: {
  done: boolean;
  open: boolean;
  label: string;
}) {
  return (
    <span
      {...stylex.props(
        styles.badge,
        done && styles.badgeDone,
        open && styles.badgeOpen,
      )}
      data-done={done}
    >
      {done ? (
        <svg
          {...stylex.props(styles.badgeCheck)}
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path d="M1.5 5.5 4 8l4.5-6" fill="none" strokeWidth="1.6" />
        </svg>
      ) : (
        label
      )}
    </span>
  );
}

/** Windows has no shell profile to edit: its user PATH reaches new terminals. */
function pathHint(shimPath: string): string {
  if (/^[a-z]:[\\/]/i.test(shimPath) || /\.cmd$/i.test(shimPath))
    return "Open a new terminal, then refresh.";
  const directory = shimPath.replace(/[\\/][^\\/]*$/, "");

  return `Add ${directory || "~/.local/bin"} to PATH, then refresh.`;
}

// Below this the fixed intro column would squeeze the steps until the agent
// rows overflow; stack the intro above them instead.
const stacked = "@media (max-width: 960px)";

// An intro column beside the step rail that owns the whole first-run flow.
const styles = stylex.create({
  page: {
    minHeight: "100%",
  },
  columns: {
    display: "flex",
    flexDirection: { default: null, [stacked]: "column" },
    gap: { default: "72px", [stacked]: "32px" },
    alignItems: "flex-start",
    paddingTop: "48px",
  },
  intro: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    width: { default: "380px", [stacked]: "auto" },
    flexShrink: 0,
  },
  kicker: {
    color: tokens.reviewHomeMeta,
  },
  headline: {
    margin: 0,
    color: tokens.ink,
    font: `500 38px/46px ${tokens.fontSerif}`,
  },
  sub: {
    margin: 0,
    color: tokens.reviewHomeMeta,
    fontSize: "13px",
    lineHeight: "21px",
  },
  dismiss: {
    alignSelf: "flex-start",
    marginTop: "4px",
  },
  steps: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    alignSelf: { default: null, [stacked]: "stretch" },
    gap: "12px",
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  // One accordion item per step. The header is always visible; only the open
  // step renders a body, so a single step asks for attention at a time.
  step: {
    display: "flex",
    flexDirection: "column",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.reviewHomeRule,
    borderRadius: "10px",
  },
  stepOpen: {
    borderColor: tokens.reviewHomeRuleSoft,
    backgroundColor: tokens.tray,
  },
  stepHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    width: "100%",
    padding: "16px 20px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: { default: null, ":focus-visible": "10px" },
    color: "inherit",
    backgroundColor: tokens.transparent,
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: null, ":disabled": 0.5 },
    textAlign: "left",
    font: "inherit",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "-2px" },
  },
  // The chevron closes the row: it sits in the trailing lane, after the note.
  stepChevron: {
    margin: "2px 2px 2px auto",
    stroke: tokens.reviewHomeMeta,
  },
  badge: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    flexShrink: 0,
    borderRadius: "50%",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.reviewHomeRuleSoft,
    color: tokens.reviewHomeMeta,
    fontSize: "11px",
    fontWeight: 500,
  },
  badgeDone: {
    borderColor: tokens.transparent,
    backgroundColor: `color-mix(in srgb, ${tokens.changeAdded} 18%, ${tokens.transparent})`,
  },
  badgeOpen: {
    borderColor: tokens.transparent,
    color: tokens.onAccent,
    backgroundColor: tokens.accent,
  },
  badgeCheck: {
    width: "10px",
    height: "10px",
    flexShrink: 0,
    fill: "none",
    stroke: tokens.changeAdded,
    strokeWidth: "1.5px",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  stepTitle: {
    color: tokens.ink,
    fontSize: "13px",
  },
  stepTitleDone: {
    color: tokens.reviewHomeMeta,
  },
  stepNote: {
    color: tokens.reviewHomeMeta,
    fontSize: "12px",
  },
  stepBody: {
    display: "flex",
    flexDirection: "column",
    padding: "0 20px 18px",
  },
  stepButton: {
    alignSelf: "flex-start",
  },
  stepButtonNext: {
    marginLeft: "8px",
  },
  // A finished step's button stays at full strength.
  stepDone: {
    opacity: 1,
  },
  hint: {
    margin: "0 0 14px",
    maxWidth: "560px",
    color: tokens.inkMuted,
    font: `13px/20px ${tokens.fontMono}`,
  },
  hintCode: {
    padding: "1px 5px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.reviewHomeRuleSoft,
    borderRadius: "4px",
    color: tokens.ink,
    backgroundColor: tokens.controlBg,
    fontFamily: tokens.fontMono,
  },
  feedback: {
    margin: "auto 0 0",
    paddingTop: "48px",
    color: tokens.reviewHomeMeta,
    fontSize: "12px",
    lineHeight: "20px",
  },
  feedbackLink: {
    color: tokens.accent,
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
});
