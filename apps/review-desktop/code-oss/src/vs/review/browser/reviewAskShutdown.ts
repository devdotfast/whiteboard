import type { IDialogService } from "../../platform/dialogs/common/dialogs.js";

/** What closes the window, in the words the warning uses. */
export type ReviewShutdownAction = "Quit" | "Close";

/**
 * Whether to keep the window open: closing it stops the agents still
 * answering in Ask, so the reviewer chooses. Nothing working, nothing asked.
 */
export async function vetoStoppingAskAgents(
  dialogs: Pick<IDialogService, "confirm">,
  agents: readonly string[],
  action: ReviewShutdownAction,
): Promise<boolean> {
  if (!agents.length) return false;

  const { confirmed } = await dialogs.confirm({
    type: "warning",
    message:
      agents.length === 1
        ? `${agents[0]} is still answering in Ask.`
        : `${agents.length} agents are still answering in Ask.`,
    detail: `${action === "Quit" ? "Quitting" : "Closing the window"} stops ${agents.length === 1 ? "it. What it" : "them. What they"} said so far is saved.`,
    primaryButton: `${action} anyway`,
    cancelButton: "Cancel",
  });

  return !confirmed;
}
