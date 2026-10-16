import { tokens } from "@canvas/tokens.stylex";
import { ChevronDownIcon } from "@canvas/ui/icons";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

/** The chevron between the crumbs of a path: Parent › Board. */
export function CrumbSeparator(): ReactElement {
  return <ChevronDownIcon xstyle={styles.separator} />;
}

const styles = stylex.create({
  separator: {
    width: "10px",
    height: "10px",
    color: tokens.inkFaint,
    transform: "rotate(-90deg)",
  },
});
