import { iconStyles } from "@canvas/ui/icon-styles";
import { FolderIcon } from "@canvas/ui/icons";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { fontSize } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

/** Where a row lives, at its end: a checkout's folder, else a project's
 * name. It never gives way, but stops at 96px. */
export function FolderLabel({ name }: { name: string }): ReactElement {
  const tooltip = useTooltip<HTMLSpanElement>(name);

  return (
    <span ref={tooltip} {...stylex.props(styles.folder)}>
      <FolderIcon xstyle={iconStyles.inline} />
      <span {...stylex.props(textStyles.truncate, styles.name)}>{name}</span>
    </span>
  );
}

const styles = stylex.create({
  folder: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: "4px",
    maxWidth: "96px",
    color: tokens.inkFaint,
    font: `${fontSize.small}/16px ${tokens.chromeFont}`,
  },
  // A folder is what a terminal would print.
  name: { minWidth: 0, fontFamily: tokens.fontMono },
});
