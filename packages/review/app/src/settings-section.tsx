import { textStyles } from "@canvas/ui/text";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode, Ref } from "react";

import { settingsStyles as styles } from "./settings-styles";

export function sectionId(label: string): string {
  return `settings-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function Section({
  label,
  ref,
  children,
}: {
  label: string;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <section ref={ref} {...stylex.props(styles.section)} aria-label={label}>
      <h2
        id={sectionId(label)}
        {...stylex.props(textStyles.eyebrow, styles.sectionLabel)}
      >
        {label}
      </h2>
      {children}
    </section>
  );
}

export function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.rowText)}>
        <span {...stylex.props(styles.rowLabel)}>{label}</span>
        {description ? (
          <span {...stylex.props(styles.rowDescription)}>{description}</span>
        ) : null}
      </div>
      <div {...stylex.props(styles.rowControl)}>{children}</div>
    </div>
  );
}
