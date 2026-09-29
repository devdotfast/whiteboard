import * as stylex from "@stylexjs/stylex";

// The tab is docked to the bottom edge, so it casts upward; elevation casts down.
export const dockShadow = stylex.defineConsts({
  open: "0 -8px 24px var(--shadow-color-strong)",
  collapsed: "0 -4px 14px var(--shadow-color-strong)",
});
