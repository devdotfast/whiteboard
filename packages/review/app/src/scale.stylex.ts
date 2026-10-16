import * as stylex from "@stylexjs/stylex";

// The canvas's scales. StyleX inlines these at build time. Pick the nearest
// step instead of writing a literal; canvas-styles/scale-literals flags literals.

export const fontSize = stylex.defineConsts({
  // Uppercase micro labels, tags and counts.
  micro: "10px",
  small: "11px",
  // Chrome and most canvas text; sets --chrome-font-size.
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
  // Highlights and thin bars.
  hairline: "2px",
  // Tags, inputs and inline marks.
  small: "4px",
  // Buttons and controls; sets --chrome-control-radius.
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
  // The contents nav over the document: the rail, and the card just above it.
  tocRail: "31",
  toc: "32",
  overlay: "40",
  // A side panel docked over the canvas as a sheet on narrow screens.
  sheet: "50",
  popover: "120",
  // A modal and its backdrop, over everything in the canvas.
  dialog: "10000",
  agentSelection: "10002",
});

export const motion = stylex.defineConsts({
  // Reduced motion, and a change that should not animate.
  instant: "0s",
  fast: "120ms",
  medium: "200ms",
  slow: "300ms",
  // One breath of a looping attention pulse.
  pulse: "1.6s",
  // One turn of a spinner: a slower one reads as stalled.
  spin: "0.8s",
  ease: "ease",
  // Something arriving: quick out of the gate, a long soft landing.
  enter: "cubic-bezier(0.2, 0.7, 0.2, 1)",
  // A panel sliding into place.
  settle: "cubic-bezier(0.2, 0.8, 0.2, 1)",
});

export const elevation = stylex.defineConsts({
  // A control lifted off its track.
  raised: "0 1px 2px var(--shadow-color)",
  // Menus, popovers and floating panels.
  popover: "0 8px 24px var(--shadow-color-strong)",
  dialog: "0 18px 60px var(--shadow-color-strong)",
  // A popover's shadow cast upward, for a panel docked to the bottom edge.
  dock: "0 -8px 24px var(--shadow-color-strong)",
  dockCollapsed: "0 -4px 14px var(--shadow-color-strong)",
  // The marker's glow around something it points at.
  markerRing: "0 0 0 3px var(--marker-glow)",
});

export const tracking = stylex.defineConsts({
  // Key hints set in Inter, which has the ⌘ glyph.
  shortcut: "0.14em",
  // Uppercase micro labels.
  caps: "0.08em",
  // Uppercase chrome labels; sets --chrome-tracking.
  chrome: "0.04em",
  // Large headings.
  tight: "-0.015em",
});
