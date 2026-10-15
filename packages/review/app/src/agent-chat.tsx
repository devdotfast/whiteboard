import { fontSize, leading, radius, space } from "@canvas/scale.stylex";
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
  xstyle,
  bubbleXstyle,
}: {
  children: ReactNode;
  caption?: ReactNode;
  xstyle?: stylex.StyleXStyles;
  /** Restyles the bubble, as on a tray. */
  bubbleXstyle?: stylex.StyleXStyles;
}): ReactElement {
  return (
    <div {...stylex.props(styles.message, xstyle)}>
      <div {...stylex.props(styles.bubble, bubbleXstyle)}>{children}</div>
      {caption != null && (
        <span {...stylex.props(styles.caption)}>{caption}</span>
      )}
    </div>
  );
}

/** The bubble on a tray (Ask's panel, the right column), lifted off it. */
export const trayBubbleStyles = stylex.create({
  bubble: {
    padding: `${space.s10} ${space.s14}`,
    backgroundColor: tokens.trayRaised,
  },
});

const styles = stylex.create({
  message: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: space.s4,
    marginTop: space.s14,
    marginLeft: "auto",
    maxWidth: "min(480px, 90%)",
    minWidth: 0,
  },
  bubble: {
    padding: `${space.s12} ${space.s14}`,
    backgroundColor: tokens.tray,
    borderRadius: `${radius.surface} ${radius.surface} ${radius.small} ${radius.surface}`,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: leading.px24,
    color: tokens.ink,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    minWidth: 0,
    maxWidth: "100%",
  },
  caption: {
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.micro,
    color: tokens.inkFaint,
  },
});
