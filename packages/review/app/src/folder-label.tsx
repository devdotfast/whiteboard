import { iconStyles } from "@canvas/ui/icon-styles";
import { FolderIcon } from "@canvas/ui/icons";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import { fontSize, leading, space } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

/** Where a row lives, at its end: a checkout's folder, else a project's
 * name. It stops at 96px; with `shrinks` it gives way down to its icon. */
export function FolderLabel({
  name,
  shrinks = false,
}: {
  name: string;
  shrinks?: boolean;
}): ReactElement {
  const tooltip = useTooltip<HTMLSpanElement>(name);

  return (
    <span
      ref={tooltip}
      {...stylex.props(styles.folder, shrinks && styles.shrinks)}
    >
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
    gap: space.s4,
    maxWidth: "96px",
    color: tokens.inkFaint,
    font: `${fontSize.small}/${leading.px16} ${tokens.chromeFont}`,
  },
  shrinks: { flexShrink: 1, minWidth: "16px" },
  // A folder is what a terminal would print.
  name: { minWidth: 0, fontFamily: tokens.fontMono },
});
