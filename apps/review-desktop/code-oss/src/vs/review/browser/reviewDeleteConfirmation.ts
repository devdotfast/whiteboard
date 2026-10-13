import type { IDialogService } from "../../platform/dialogs/common/dialogs.js";

export async function confirmReviewDeletion(
  dialogs: Pick<IDialogService, "confirm">,
  titles: readonly string[],
  isCurrent: () => boolean,
): Promise<boolean> {
  const one = titles.length === 1;
  const result = await dialogs.confirm({
    type: "warning",
    message: one ? `Delete “${titles[0].trim() || "Untitled whiteboard"}”?` : `Delete ${titles.length} whiteboards?`,
    detail: `This permanently deletes ${one ? "it, with its" : "them, with their"} versions and threads. Your source repository is not deleted.`,
    primaryButton: "Delete",
    cancelButton: "Cancel",
  });
  return result.confirmed && isCurrent();
}
