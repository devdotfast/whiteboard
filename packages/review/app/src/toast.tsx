import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";

import { useOptionalReviewSession } from "./host/review-session";
import { appMarker } from "./markers.stylex";
import { elevation, fontSize, layer, radius } from "./scale.stylex";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";

type ToastMessage = { kind: "success" | "error"; text: string };

export function useToast(durationMs = 6_000) {
  const session = useOptionalReviewSession();
  const [message, setMessage] = useState<ToastMessage | null>(null);

  const showToast = useCallback(
    (message: ToastMessage) => {
      if (session?.bridge.notify) session.bridge.notify(message);
      else setMessage(message);
    },
    [session],
  );

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), durationMs);

    return () => window.clearTimeout(timeout);
  }, [message, durationMs]);

  return {
    showToast,
    toast: message ? <Toast message={message} /> : null,
  };
}

function Toast({ message }: { message: ToastMessage }) {
  return (
    <div
      {...stylex.props(
        shellStyles.topbarItem,
        styles.toast,
        styles[message.kind],
      )}
      role="status"
    >
      {message.text}
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
  success: { borderColor: tokens.diffAdded },
  error: { borderColor: tokens.diffModified },
});
