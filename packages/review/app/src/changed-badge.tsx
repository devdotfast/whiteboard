import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

/**
 * Marks a board that changed since it was last viewed. `onIcon` pins it to
 * an icon's corner; otherwise it sits inline before a title.
 */
export function ChangedBadge({
  onIcon = false,
}: {
  onIcon?: boolean;
}): ReactElement {
  return (
    <span
      role="img"
      aria-label="Changed since you last viewed it"
      data-changed=""
      {...stylex.props(styles.badge, onIcon ? styles.onIcon : styles.inline)}
    />
  );
}

const styles = stylex.create({
  badge: {
    display: "inline-block",
    flexShrink: 0,
    width: "6px",
    height: "6px",
    borderRadius: radius.round,
    backgroundColor: tokens.accent,
  },
  onIcon: {
    position: "absolute",
    top: "-3px",
    right: "-4px",
    width: "8px",
    height: "8px",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: tokens.tray,
  },
  inline: { marginRight: "6px", verticalAlign: "middle" },
});
