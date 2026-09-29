import * as stylex from "@stylexjs/stylex";

// The canvas's scales. StyleX inlines these at build time. Pick the nearest
// step instead of writing a literal; canvas-styles/scale-literals flags literals.

export const fontSize = stylex.defineConsts({
  // Uppercase micro labels, tags and counts.
  micro: "10px",
  small: "11px",
  // Chrome and most canvas text; matches --chrome-font-size.
  body: "12px",
  ui: "13px",
  reading: "15px",
  heading: "18px",
  display: "22px",
});

export const fontWeight = stylex.defineConsts({
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
});

export const radius = stylex.defineConsts({
  // Tags, inputs and inline marks.
  small: "4px",
  // Buttons and controls; matches --chrome-control-radius.
  control: "6px",
  // Popovers, cards and dialogs.
  surface: "8px",
  pill: "999px",
  round: "50%",
});

// Stacking for things that escape their own component. Ordering inside one
// component (0–9) stays local.
export const layer = stylex.defineConsts({
  sticky: "20",
  overlay: "40",
  popover: "120",
  toast: "10001",
  agentSelection: "10002",
});

export const motion = stylex.defineConsts({
  fast: "120ms",
  medium: "200ms",
  slow: "300ms",
  ease: "ease",
});

export const elevation = stylex.defineConsts({
  // A control lifted off its track.
  raised: "0 1px 2px var(--shadow-color)",
  // Menus, popovers and floating panels.
  popover: "0 8px 24px var(--shadow-color-strong)",
  dialog: "0 18px 60px var(--shadow-color-strong)",
});

export const tracking = stylex.defineConsts({
  // Uppercase micro labels.
  caps: "0.08em",
  // Uppercase chrome labels; matches --chrome-tracking.
  chrome: "0.04em",
});
