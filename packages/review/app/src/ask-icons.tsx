import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

import type { IconProps } from "./icons";

function AskGlyph({
  viewBox,
  xstyle,
  children,
  strong = false,
}: IconProps & { viewBox: string; children: ReactNode; strong?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      {...stylex.props(styles.icon, strong && styles.strong, xstyle)}
      focusable="false"
      viewBox={viewBox}
    >
      {children}
    </svg>
  );
}

export function AskIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <AskGlyph viewBox="0 0 16 16" xstyle={xstyle}>
      <path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" />
    </AskGlyph>
  );
}

export function AskCopyIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <AskGlyph viewBox="0 0 16 16" xstyle={xstyle}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
    </AskGlyph>
  );
}

export function AskLockIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <AskGlyph viewBox="0 0 16 16" xstyle={xstyle}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </AskGlyph>
  );
}

export function AskArrowIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <AskGlyph viewBox="0 0 12 12" xstyle={xstyle}>
      <path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" />
    </AskGlyph>
  );
}

export function AskHistoryIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <AskGlyph viewBox="0 0 16 16" xstyle={xstyle}>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.6h2.6M8 5v3.2l2 1.3" />
    </AskGlyph>
  );
}

export function AskChevronIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <AskGlyph viewBox="0 0 12 12" xstyle={xstyle} strong>
      <path d="M2.5 4.25 6 8l3.5-3.75" />
    </AskGlyph>
  );
}

export function AskCheckIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <AskGlyph viewBox="0 0 12 12" xstyle={xstyle} strong>
      <path d="M2.5 6.2 4.9 8.5 9.5 3.5" />
    </AskGlyph>
  );
}

export function AskCrossIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <AskGlyph viewBox="0 0 12 12" xstyle={xstyle}>
      <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" />
    </AskGlyph>
  );
}

export function AskImageIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <AskGlyph viewBox="0 0 16 16" xstyle={xstyle}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1" />
      <path d="M13.5 10.5 10.5 7.5 4 13" />
    </AskGlyph>
  );
}

export function AskTrashIcon({ xstyle }: IconProps = {}): ReactElement {
  return (
    <AskGlyph viewBox="0 0 16 16" xstyle={xstyle}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" />
    </AskGlyph>
  );
}

const styles = stylex.create({
  icon: {
    flex: "0 0 auto",
    width: "12px",
    height: "12px",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.3px",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  strong: {
    strokeWidth: "1.5px",
  },
});

// Sizes the icons take in their controls.
export const askIconSizes = stylex.create({
  small: { width: "11px", height: "11px" },
  toolbar: { width: "13px", height: "13px" },
  header: { width: "14px", height: "14px" },
  // With the chrome's icon size.
  chrome: { strokeWidth: "1.4px" },
});
