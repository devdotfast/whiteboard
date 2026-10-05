import { fontSize } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

export function StatusBanner({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <div {...stylex.props(styles.banner)} role="status">
      <span>{children}</span>
      {action}
    </div>
  );
}

const styles = stylex.create({
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "6px 12px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
    backgroundColor: `color-mix(in srgb, ${tokens.accent} 12%, ${tokens.surface})`,
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
  },
});
