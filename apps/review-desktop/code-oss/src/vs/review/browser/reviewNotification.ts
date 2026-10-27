import { toAction } from "../../base/common/actions.js";
import { Event } from "../../base/common/event.js";
import { type INotificationService, Severity } from "../../platform/notification/common/notification.js";
import type { ReviewDisposable, ReviewNotification } from "../common/reviewProtocol.js";

export function showReviewNotification(
  notifications: Pick<INotificationService, "notify">,
  { kind, text, actions, closeAfterMs, onClose }: ReviewNotification,
): ReviewDisposable {
  const handle = notifications.notify({
    severity: kind === "error" ? Severity.Error : Severity.Info,
    message: text,
    actions: actions?.length
      ? { primary: actions.map((action, index) => toAction({ id: `review.notification.${index}`, label: action.label, run: () => action.run() })) }
      : undefined,
  });
  if (closeAfterMs !== undefined) {
    const timer = setTimeout(() => handle.close(), closeAfterMs);
    Event.once(handle.onDidClose)(() => clearTimeout(timer));
  }
  if (onClose) Event.once(handle.onDidClose)(onClose);
  return { dispose: () => handle.close() };
}
