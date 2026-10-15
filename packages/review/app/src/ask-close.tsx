import { fontSize, fontWeight } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, type RefObject, useEffect, useRef } from "react";

import { tokens } from "./tokens.stylex";
import { Button } from "./ui/button";
import { menuStyles } from "./ui/menu";
import { Popover } from "./ui/popover";

/** Asked from the close button of an Ask whose agent is working: closing
 * stops it, and keeping it running hides it, still in the Threads tab. */
export function AskCloseWarning({
  anchor,
  agentName,
  onKeepRunning,
  onClose,
  onKeep,
}: {
  /** The close button it hangs from. */
  anchor: RefObject<HTMLElement | null>;
  agentName: string;
  onKeepRunning: () => void;
  onClose: () => void;
  onKeep: () => void;
}): ReactElement {
  const keepRunning = useRef<HTMLButtonElement>(null);

  useEffect(() => keepRunning.current?.focus(), []);

  // A press anywhere else keeps the Ask; the close button asks again.
  return (
    <Popover
      anchor={anchor}
      onDismiss={onKeep}
      xstyle={[menuStyles.popover, menuStyles.end, styles.warning]}
      role="alertdialog"
      aria-label={`Stop ${agentName}?`}
    >
      <p {...stylex.props(styles.title)}>Stop {agentName}?</p>
      <p {...stylex.props(styles.text)}>
        {agentName} is still running. Keep it running to find it in Threads.
      </p>
      <span {...stylex.props(styles.actions)}>
        <Button variant="ghost" onClick={onClose}>
          Stop and close
        </Button>
        <Button ref={keepRunning} variant="primary" onClick={onKeepRunning}>
          Keep running
        </Button>
      </span>
    </Popover>
  );
}

const styles = stylex.create({
  warning: {
    gap: "6px",
    width: "276px",
    padding: "12px 12px 10px 14px",
    overflowY: "visible",
    fontFamily: tokens.chromeFont,
  },
  title: {
    margin: 0,
    color: tokens.ink,
    fontSize: fontSize.ui,
    fontWeight: fontWeight.semibold,
    lineHeight: "18px",
  },
  text: {
    margin: 0,
    color: tokens.inkMuted,
    fontSize: fontSize.body,
    lineHeight: "18px",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "6px",
    marginTop: "6px",
  },
});
