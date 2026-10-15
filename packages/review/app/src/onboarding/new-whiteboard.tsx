import { withClass } from "@canvas/stylex-props";
import type { ReviewCanvasSetupActions } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";

import { DrawFlow, useOnboardingClient } from "./draw-flow";
import { onboardingStyles as styles } from "./onboarding-styles";

const LEAD =
  "Pick a branch, worktree or pull request. Draw it with an agent right here, or copy the prompt into your own.";

/**
 * Draw a whiteboard from Home, as first run's last step does: full window
 * from New whiteboard, or set into Home itself while it has nothing to list.
 */
export function NewWhiteboard({
  setupActions,
  embedded = false,
  onClose,
  onCopied,
}: {
  setupActions: ReviewCanvasSetupActions;
  embedded?: boolean;
  /** Back to the list; the full-window screen only. */
  onClose?(): void;
  /** The prompt went to the clipboard, for the reader's own agent. */
  onCopied?(): void;
}) {
  const { client, unavailable } = useOnboardingClient(setupActions);

  const content = unavailable ? (
    <p role="alert" {...stylex.props(styles.error)}>
      Whiteboard could not reach its server: {unavailable}
    </p>
  ) : client ? (
    <DrawFlow
      client={client}
      setupActions={setupActions}
      embedded={embedded}
      onStarted={onClose}
      onCopied={onCopied}
      intro={
        embedded
          ? undefined
          : {
              back: onClose
                ? { label: "Whiteboards", onClick: onClose }
                : undefined,
              heading: "New whiteboard.",
              lead: LEAD,
            }
      }
    />
  ) : null;

  if (embedded) return content;

  return (
    <main {...withClass("review-onboarding", styles.page, styles.railless)}>
      {content}
    </main>
  );
}
