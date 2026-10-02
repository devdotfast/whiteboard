import * as stylex from "@stylexjs/stylex";

import { fontSize, fontWeight, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

// Controls shared across the canvas.
export const controlStyles = stylex.create({
  // Segmented choice controls: a tray-colored track, the chosen side raised
  // on a hairline. One part for every "pick one of a few" setting. The
  // surface tabs on the left of the top bar are the exception: words on the
  // tray with the marker under the current one.
  segmented: {
    display: "flex",
    flex: "0 0 auto",
    alignItems: "center",
    gap: 0,
    padding: "2px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.control,
    backgroundColor: tokens.tray,
  },
  segmentedTopbar: {
    gap: "18px",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: 0,
    backgroundColor: tokens.transparent,
  },
  segment: {
    display: "inline-flex",
    alignItems: "center",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
    fontFamily: tokens.chromeFont,
    whiteSpace: "nowrap",
    position: "relative",
    gap: "6px",
    height: "20px",
    padding: "0 10px",
    borderRadius: radius.small,
    color: { default: tokens.inkMuted, ":hover": tokens.ink },
    fontSize: fontSize.small,
    fontWeight: fontWeight.medium,
    opacity: { default: null, ":disabled": 0.5 },
    cursor: { default: null, ":disabled": "default" },
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "-1px" },
  },
  // Segments set in prose (the welcome and tutorial pages) grow a step.
  segmentLarge: {
    height: "26px",
    padding: "0 12px",
    fontSize: fontSize.ui,
  },
  segmentTopbar: {
    height: tokens.reviewHeaderHeight,
    padding: 0,
    borderRadius: { default: 0, ":focus-visible": radius.small },
    fontSize: fontSize.body,
    fontWeight: fontWeight.regular,
  },
  segmentActive: {
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.ruleSoft}`,
    color: tokens.ink,
    fontWeight: fontWeight.semibold,
  },
  segmentTopbarActive: {
    backgroundColor: tokens.transparent,
    boxShadow: "none",
  },
  segmentCount: {
    flex: "0 0 auto",
    fontVariantNumeric: "tabular-nums",
    color: tokens.inkFaint,
    fontSize: fontSize.body,
    fontWeight: fontWeight.regular,
  },
  segmentCountActive: {
    color: tokens.accent,
  },

  // The icon never takes the pointer from its button.
  inertIcon: {
    pointerEvents: "none",
  },
  // Icons in top bar chrome buttons.
  chromeIcon: {
    width: tokens.chromeIconSize,
    height: tokens.chromeIconSize,
  },
  // Icons beside a label, in a button or chip.
  inlineIcon: {
    width: "12px",
    height: "12px",
  },
});
