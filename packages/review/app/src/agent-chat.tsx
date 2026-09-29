import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

import { tokens } from "./tokens.stylex";

/**
 * Agent-chat row for whatever the human said: a right-aligned bubble with an
 * optional caption.
 */

export function AgentChatUserMessage({
  children,
  caption,
}: {
  children: ReactNode;
  caption?: ReactNode;
}): ReactElement {
  return (
    <div {...stylex.props(styles.message)}>
      <div {...stylex.props(styles.bubble)}>{children}</div>
      {caption != null && (
        <span {...stylex.props(styles.caption)}>{caption}</span>
      )}
    </div>
  );
}

const styles = stylex.create({
  message: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "5px",
    marginTop: "14px",
    marginLeft: "auto",
    maxWidth: "min(480px, 90%)",
    minWidth: 0,
  },
  bubble: {
    padding: "12px 14px",
    backgroundColor: tokens.tray,
    borderRadius: "12px 12px 4px 12px",
    fontFamily: tokens.fontSerif,
    fontSize: "15px",
    lineHeight: "24px",
    color: tokens.ink,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    minWidth: 0,
    maxWidth: "100%",
  },
  caption: {
    fontFamily: tokens.fontMono,
    fontSize: "10.5px",
    color: tokens.inkFaint,
  },
});
