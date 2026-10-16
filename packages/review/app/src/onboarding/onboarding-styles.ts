import { railStepMarker } from "@canvas/markers.stylex";
import {
  fontSize,
  fontWeight,
  motion,
  radius,
  tracking,
} from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

import {
  onboardingMotion,
  onboardingTracking,
  onboardingType,
} from "./onboarding.stylex";

// Below this the copy column stacks above the screen's panel.
const stacked = "@media (max-width: 1100px)";

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(12px)" },
  to: { opacity: 1, transform: "none" },
});

const spin = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

const enter = {
  animationName: { default: rise, [stylex.env.reducedMotion]: "none" },
  animationDuration: onboardingMotion.screen,
  animationTimingFunction: motion.enter,
  animationFillMode: "both",
} as const;

/** One full-window screen per step, under a rail that names the three. */
export const onboardingStyles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    overflow: "auto",
    color: tokens.ink,
    backgroundColor: tokens.bg,
  },
  rail: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    height: "56px",
    paddingInline: "24px",
  },
  railSide: {
    display: "flex",
    justifyContent: "flex-end",
    width: "200px",
    flexShrink: 0,
  },
  railSteps: {
    display: "flex",
    listStyle: "none",
    flex: 1,
    justifyContent: "center",
    gap: "28px",
  },
  railStep: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "120px",
    padding: 0,
    borderWidth: 0,
    backgroundColor: tokens.transparent,
    color: "inherit",
    cursor: { default: "pointer", ":disabled": "default" },
    font: "inherit",
    textAlign: "start",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "4px" },
  },
  railTrack: {
    height: "2px",
    overflow: "hidden",
    borderRadius: radius.hairline,
    backgroundColor: tokens.rule,
  },
  railFill: {
    display: "block",
    height: "100%",
    backgroundColor: tokens.accent,
    transformOrigin: "left",
    transitionProperty: "transform",
    transitionDuration: {
      default: onboardingMotion.screen,
      [stylex.env.reducedMotion]: motion.instant,
    },
    transitionTimingFunction: motion.enter,
  },
  railLabel: {
    color: {
      default: tokens.inkFaint,
      [stylex.when.ancestor(":enabled:hover", railStepMarker)]: tokens.inkMuted,
    },
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  railLabelCurrent: {
    color: tokens.ink,
    fontWeight: fontWeight.medium,
  },
  stage: {
    display: "flex",
    flex: 1,
    flexDirection: { default: "row", [stacked]: "column" },
    alignItems: { default: "center", [stacked]: "stretch" },
    gap: { default: "80px", [stacked]: "40px" },
    // Bounded, so a panel that outgrows the window scrolls inside itself.
    minHeight: 0,
    paddingBlock: "24px 56px",
    paddingInline: { default: "120px 96px", [stacked]: "48px" },
  },
  // A working screen: its title bar, then its content, in one column.
  sheet: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    alignSelf: "center",
    width: "100%",
    maxWidth: "880px",
    minHeight: 0,
    paddingBlock: "20px 32px",
    paddingInline: "40px",
    boxSizing: "border-box",
  },
  // The same screen set inside a page that already pads and titles it.
  sheetEmbedded: {
    flex: "none",
    alignSelf: "stretch",
    maxWidth: "none",
    paddingBlock: 0,
    paddingInline: 0,
  },
  // A screen with no rail above it starts where the rail would end.
  railless: {
    paddingTop: "56px",
  },
  backLink: {
    alignSelf: "flex-start",
    marginInline: "-10px",
    fontFamily: tokens.fontMono,
  },
  titleBar: {
    display: "flex",
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: "32px",
    paddingBottom: "28px",
  },
  titleText: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    minWidth: 0,
  },
  heading: {
    margin: 0,
    fontFamily: tokens.fontSerif,
    fontSize: onboardingType.heading,
    fontWeight: fontWeight.medium,
    letterSpacing: onboardingTracking.display,
    lineHeight: onboardingType.headingLeading,
  },
  subLead: {
    margin: 0,
    maxWidth: "560px",
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: 1.5,
  },
  titleActions: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: "16px",
  },
  copy: {
    display: "flex",
    flexDirection: "column",
    width: { default: "500px", [stacked]: "auto" },
    flexShrink: 0,
  },
  panel: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
    borderRadius: radius.surface,
    backgroundColor: tokens.tray,
  },
  eyebrow: {
    paddingBottom: "28px",
    color: tokens.accent,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
    letterSpacing: tracking.caps,
    textTransform: "uppercase",
  },
  hero: {
    margin: 0,
    // Even lines, so the last never holds one word alone.
    textWrap: "balance",
    fontFamily: tokens.fontSerif,
    fontSize: onboardingType.hero,
    fontWeight: fontWeight.medium,
    letterSpacing: onboardingTracking.display,
    lineHeight: onboardingType.heroLeading,
  },
  title: {
    margin: 0,
    fontFamily: tokens.fontSerif,
    fontSize: onboardingType.title,
    fontWeight: fontWeight.medium,
    letterSpacing: onboardingTracking.display,
    lineHeight: onboardingType.titleLeading,
  },
  lead: {
    margin: 0,
    paddingTop: "28px",
    maxWidth: "460px",
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: onboardingType.lead,
    lineHeight: onboardingType.leadLeading,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "20px",
    paddingTop: "40px",
  },
  primary: {
    gap: "8px",
    height: "36px",
    paddingInline: "16px 14px",
    fontSize: fontSize.ui,
  },
  primaryKey: {
    borderColor: tokens.transparent,
    backgroundColor: tokens.onAccentWash,
    color: tokens.onAccent,
  },
  error: {
    margin: 0,
    paddingTop: "16px",
    color: tokens.changeRemoved,
    fontSize: fontSize.ui,
  },
  enter0: { ...enter, animationDelay: motion.instant },
  enter1: { ...enter, animationDelay: onboardingMotion.stagger },
  enter2: { ...enter, animationDelay: `calc(${onboardingMotion.stagger} * 2)` },
  enter3: { ...enter, animationDelay: `calc(${onboardingMotion.stagger} * 3)` },
  spinner: {
    width: "20px",
    height: "20px",
    flexShrink: 0,
    animationName: { default: spin, [stylex.env.reducedMotion]: "none" },
    animationDuration: motion.spin,
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  spinnerTrack: {
    fill: "none",
    stroke: tokens.markerTint,
    strokeWidth: 2,
  },
  spinnerArc: {
    fill: "none",
    stroke: tokens.accent,
    strokeLinecap: "round",
    strokeWidth: 2,
  },
});
