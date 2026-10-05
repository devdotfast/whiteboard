import { fontSize, fontWeight } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, type RefObject, useEffect, useRef } from "react";

import { tokens } from "./tokens.stylex";
import { Button } from "./ui/button";
import { menuStyles } from "./ui/menu";
import { surfaceStyles } from "./ui/surface";
import { useAnchoredPopover } from "./use-anchored-popover";

/** Asked from the close button of an Ask whose agent is working: closing
 * stops it, and minimizing keeps it going out of the way. */
export function AskCloseWarning({
  anchor,
  agentName,
  onMinimize,
  onClose,
  onKeep,
}: {
  /** The close button it hangs from. */
  anchor: RefObject<HTMLElement | null>;
  agentName: string;
  onMinimize: () => void;
  onClose: () => void;
  onKeep: () => void;
}): ReactElement {
  const popover = useAnchoredPopover(true, anchor);
  const minimize = useRef<HTMLButtonElement>(null);

  useEffect(() => minimize.current?.focus(), []);

  // A press anywhere else keeps the Ask; the close button asks again.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        (popover.current?.contains(event.target) ||
          anchor.current?.contains(event.target))
      )
        return;
      onKeep();
    };

    document.addEventListener("pointerdown", outside);

    return () => document.removeEventListener("pointerdown", outside);
  }, [popover, anchor, onKeep]);

  return (
    <div
      ref={popover}
      popover="manual"
      {...stylex.props(
        menuStyles.popover,
        menuStyles.end,
        surfaceStyles.popover,
        styles.warning,
      )}
      role="alertdialog"
      aria-label={`Stop ${agentName}?`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onKeep();
      }}
    >
      <p {...stylex.props(styles.title)}>Stop {agentName}?</p>
      <p {...stylex.props(styles.text)}>
        {agentName} is still running. Minimize to keep running.
      </p>
      <span {...stylex.props(styles.actions)}>
        <Button variant="ghost" onClick={onClose}>
          Stop and close
        </Button>
        <Button ref={minimize} variant="primary" onClick={onMinimize}>
          Minimize
        </Button>
      </span>
    </div>
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
