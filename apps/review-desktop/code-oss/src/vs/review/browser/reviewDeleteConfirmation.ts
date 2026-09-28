import type { IDialogService } from "../../platform/dialogs/common/dialogs.js";

export async function confirmReviewDeletion(
  dialogs: Pick<IDialogService, "confirm">,
  title: string,
  isCurrent: () => boolean,
): Promise<boolean> {
  const result = await dialogs.confirm({
    type: "warning",
    message: `Delete “${title.trim() || "Untitled session"}”?`,
    detail: "This permanently deletes the session. Your source repository is not deleted.",
    primaryButton: "Delete",
    cancelButton: "Cancel",
  });
  return result.confirmed && isCurrent();
}
