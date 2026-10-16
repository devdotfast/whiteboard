import { MarkdownString } from "../../base/common/htmlContent.js";
import type { IDialogService } from "../../platform/dialogs/common/dialogs.js";

/** A whiteboard the delete confirmation names. */
export interface ReviewDeleteListedBoard {
  title: string;
  pullRequestNumber?: number;
}

/** The boards the confirmation names: those linking to the boards asked
 * about, and their children, which move to top level. */
export interface ReviewDeleteNamed {
  linkedFrom: readonly ReviewDeleteListedBoard[];
  movesUp?: readonly ReviewDeleteListedBoard[];
}

const boardTitle = (title: string) => title.trim() || "Untitled whiteboard";

/** One line per board, with its PR number. */
const listed = (boards: readonly ReviewDeleteListedBoard[]) =>
  boards
    .map(({ title, pullRequestNumber }) =>
      `- ${new MarkdownString().appendText(boardTitle(title)).value}${pullRequestNumber ? ` #${pullRequestNumber}` : ""}`)
    .join("\n");

/**
 * Asks before deleting whiteboards, or moving them to Trash, in the
 * workbench's dialog. It names the children that move to top level and the
 * whiteboards that link here, whose links will show as deleted. Trash is
 * undone in a click, so it asks then only when other boards need them.
 */
export async function confirmReviewDeletion(
  dialogs: Pick<IDialogService, "confirm">,
  titles: readonly string[],
  isCurrent: () => boolean,
  named: ReviewDeleteNamed = { linkedFrom: [] },
  trash = false,
): Promise<boolean> {
  const { linkedFrom, movesUp = [] } = named;

  if (trash && !linkedFrom.length && !movesUp.length) return isCurrent();
  const one = titles.length === 1;
  const them = one ? "it" : "them";
  const deleted = one ? "it is deleted" : "they are deleted";
  const subject = one ? `“${boardTitle(titles[0])}”` : `${titles.length} whiteboards`;

  const details = [
    movesUp.length > 0 &&
      `${movesUp.length} ${movesUp.length === 1 ? "whiteboard is" : "whiteboards are"} nested under ${them}. ${movesUp.length === 1 ? "It moves" : "They move"} to top level${trash ? ` when ${deleted} from Trash` : ""}.\n\n${listed(movesUp)}`,
    linkedFrom.length > 0 &&
      `${linkedFrom.length} ${linkedFrom.length === 1 ? "whiteboard links" : "whiteboards link"} here. ${trash ? `Once ${deleted} from Trash, their` : "Their"} links will show as deleted.\n\n${listed(linkedFrom)}`,
  ].filter((detail): detail is string => detail !== false);

  const result = await dialogs.confirm({
    type: "warning",
    message: trash ? `Move ${subject} to Trash?` : `Delete ${subject}?`,
    detail: trash
      ? undefined
      : `This permanently deletes ${one ? "it, with its" : "them, with their"} versions and threads. Your source repository is not deleted.`,
    primaryButton: trash ? "Move to Trash" : "Delete",
    cancelButton: "Cancel",
    ...(details.length > 0 && {
      custom: {
        markdownDetails: details.map((detail) => ({ markdown: new MarkdownString(detail) })),
      },
    }),
  });
  return result.confirmed && isCurrent();
}
