import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useEffect, useRef } from "react";

import { fontSize } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { Button } from "./ui/button";

/** Asked before closing an Ask whose agent is working: closing stops it,
 * and minimizing keeps it going out of the way. */
export function AskCloseWarning({
  agentName,
  onMinimize,
  onClose,
  onKeep,
}: {
  agentName: string;
  onMinimize: () => void;
  onClose: () => void;
  onKeep: () => void;
}): ReactElement {
  const minimize = useRef<HTMLButtonElement>(null);

  useEffect(() => minimize.current?.focus(), []);

  return (
    <div
      {...stylex.props(styles.warning)}
      role="alertdialog"
      aria-label="Close Ask?"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onKeep();
      }}
    >
      <span {...stylex.props(styles.text)}>
        {agentName} is still working. Closing stops it; minimize to keep it
        going.
      </span>
      <span {...stylex.props(styles.actions)}>
        <Button ref={minimize} variant="primary" onClick={onMinimize}>
          Minimize
        </Button>
        <Button onClick={onClose}>Stop and close</Button>
      </span>
    </div>
  );
}

const styles = stylex.create({
  warning: {
    display: "flex",
    flex: "0 0 auto",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px 12px",
    padding: "8px 12px 8px 16px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
    backgroundColor: tokens.warningWash,
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "18px",
  },
  text: {
    flex: "1 1 200px",
    minWidth: 0,
  },
  actions: {
    display: "flex",
    flex: "0 0 auto",
    gap: "8px",
    marginLeft: "auto",
  },
});
