import type { ReviewNotification } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { CanvasUiContext } from "./host/canvas-ui";
import { useOptionalReviewSession } from "./host/review-session";
import { CloseIcon } from "./icons";
import { appMarker } from "./markers.stylex";
import { elevation, fontSize, layer, radius } from "./scale.stylex";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";
import { Button, IconButton } from "./ui/button";

/** Prefers host notifications; `showToast` returns a function that closes it. */
export function useToast(durationMs = 6_000) {
  const session = useOptionalReviewSession();
  const ui = useContext(CanvasUiContext);
  const notify = session ? session.bridge.notify : ui?.notify;

  const [message, setMessage] = useState<ReviewNotification | null>(null);
  const current = useRef<ReviewNotification | null>(null);

  const close = useCallback((notification: ReviewNotification) => {
    if (current.current !== notification) return;
    current.current = null;
    setMessage(null);
    notification.onClose?.();
  }, []);

  const showToast = useCallback(
    (notification: ReviewNotification) => {
      if (notify) {
        const handle = notify(notification);

        return () => handle.dispose();
      }

      if (current.current) close(current.current);
      current.current = notification;
      setMessage(notification);

      return () => close(notification);
    },
    [notify, close],
  );

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => close(message), durationMs);

    return () => window.clearTimeout(timeout);
  }, [message, durationMs, close]);

  return {
    showToast,
    toast: message ? (
      <Toast message={message} onClose={() => close(message)} />
    ) : null,
  };
}

function Toast({
  message,
  onClose,
}: {
  message: ReviewNotification;
  onClose(): void;
}) {
  return (
    <div
      {...stylex.props(
        shellStyles.topbarItem,
        styles.toast,
        styles[message.kind],
      )}
      role="status"
    >
      <span {...stylex.props(styles.text)}>{message.text}</span>
      {message.actions?.map((action) => (
        <Button
          key={action.label}
          onClick={() => {
            onClose();
            action.run();
          }}
        >
          {action.label}
        </Button>
      ))}
      {message.actions?.length ? (
        <IconButton
          aria-label="Dismiss notification"
          size="small"
          onClick={onClose}
        >
          <CloseIcon />
        </IconButton>
      ) : null}
    </div>
  );
}

const inApp = () => stylex.when.ancestor(":is(*)", appMarker);

const styles = stylex.create({
  // Notification colors on purpose: it reads as the host's own toast.
  toast: {
    position: "fixed",
    zIndex: layer.toast,
    right: "18px",
    bottom: "18px",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    maxWidth: "380px",
    // Only the app root defines --chrome-border, and the border came from a
    // shorthand that drops out without it: a toast portaled outside the app
    // has none.
    borderWidth: { default: 0, [inApp()]: "1px" },
    borderStyle: { default: "none", [inApp()]: "solid" },
    borderRadius: radius.surface,
    padding: "10px 12px",
    backgroundColor: "var(--vscode-notifications-background, var(--tray))",
    boxShadow: elevation.popover,
    color: "var(--vscode-notifications-foreground, var(--ink))",
    font: `${fontSize.small}/1.4 ${tokens.fontMono}`,
  },
  text: { flex: "1 1 200px" },
  success: { borderColor: tokens.diffAdded },
  error: { borderColor: tokens.diffModified },
});
