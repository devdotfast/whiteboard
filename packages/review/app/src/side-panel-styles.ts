import * as stylex from "@stylexjs/stylex";

import { radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

const narrowCanvas = "@container review-canvas (max-width: 929px)";

const narrow = "@media (max-width: 720px)";

const short = "@media (max-height: 560px)";

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

// The panel's own grid cell in App's detail host.
const inDetailHost = ":is(.review-detail-host > *)";

// Narrow layouts dock the panel to the bottom of the canvas as a sheet; a
// short canvas gives the sheet its whole height.
const sheetHeight = "calc(var(--side-panel-bottom-fraction, 0.5) * 100%)";

const slideIn = stylex.keyframes({
  from: { opacity: 0.3, transform: "translateX(28px)" },
  to: { opacity: 1, transform: "translateX(0)" },
});

export const panelStyles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    position: {
      default: null,
      [narrowCanvas]: "absolute",
      [narrow]: "absolute",
    },
    inset: {
      default: null,
      [narrowCanvas]: { default: "auto 0 0 0", [short]: 0 },
      [narrow]: { default: "auto 0 0 0", [short]: 0 },
      [short]: 0,
    },
    zIndex: { default: null, [narrowCanvas]: 50, [narrow]: 50 },
    height: {
      default: "100%",
      [narrowCanvas]: { default: sheetHeight, [short]: "100%" },
      [narrow]: { default: sheetHeight, [short]: "100%" },
    },
    maxHeight: {
      default: null,
      [narrowCanvas]: { default: "100%", [short]: "none" },
      [narrow]: { default: "100%", [short]: "none" },
      [short]: "none",
    },
    gridArea: { default: null, [inDetailHost]: "1 / 1" },
    overflow: "hidden",
    backgroundColor: tokens.bg,
    animationName: { default: slideIn, [reducedMotion]: "none" },
    animationDuration: { default: "200ms", [reducedMotion]: "0s" },
    animationTimingFunction: { default: "ease-out", [reducedMotion]: "ease" },
  },
  restored: {
    animationName: "none",
    animationDuration: "0s",
    animationTimingFunction: "ease",
  },
  tour: {
    position: {
      default: "relative",
      [narrowCanvas]: "absolute",
      [narrow]: "absolute",
    },
  },
  // Inside a diagram tour the panel keeps its column at every width.
  docked: {
    position: "static",
    inset: "auto",
    width: "100%",
    height: "100%",
    maxHeight: "none",
  },
  header: {
    display: "flex",
    flex: "0 0 auto",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    minHeight: tokens.reviewHeaderHeight,
    padding: "0 10px 0 16px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.surface,
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
    minWidth: 0,
  },
  kicker: {
    flex: "0 0 auto",
    fontFamily: tokens.fontMono,
  },
  heading: {
    overflow: "hidden",
    margin: 0,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: "13px",
    fontWeight: 600,
    lineHeight: 1.3,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  close: {
    flex: "0 0 auto",
  },
  body: {
    paddingBottom: "var(--review-bottom-scroll-padding, 0px)",
    flex: "1 1 auto",
    minWidth: 0,
    minHeight: 0,
    overflowX: "hidden",
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  peekBody: {
    minWidth: 0,
    padding: { default: "12px", [narrow]: "8px" },
  },
  peekActions: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: "12px",
  },
  peekContent: {
    minWidth: 0,
  },
});

// The guided tour: a numbered rail of stops in the panel body, and a pager
// pill floating over its foot.
export const tourStyles = stylex.create({
  feedShell: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    minHeight: 0,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  feed: {
    padding: "0 0 72px",
    scrollPaddingTop: "18px",
    scrollPaddingBottom: "72px",
  },
  floatingFooter: {
    position: "absolute",
    right: 0,
    bottom: { default: "12px", [narrow]: "8px" },
    left: 0,
    zIndex: 4,
    display: "flex",
    justifyContent: "center",
    padding: { default: "0 12px", [narrow]: "0 8px" },
    pointerEvents: "none",
  },
  pill: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 10px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: "999px",
    backgroundColor: tokens.accent,
    boxShadow: `0 2px 10px ${tokens.shadowColorStrong}`,
    color: tokens.onAccent,
    fontSize: "11px",
    fontWeight: 700,
    pointerEvents: "auto",
  },
  pillIntro: {
    gap: "7px",
    padding: "7px 14px",
    cursor: "pointer",
  },
  pillChevron: {
    color: tokens.onAccent,
  },
  // An IconButton on the accent pill.
  pillButton: {
    borderRadius: radius.round,
    backgroundColor: {
      default: tokens.transparent,
      ":hover:not(:disabled)": `color-mix(in srgb, ${tokens.onAccent} 16%, ${tokens.transparent})`,
      ":focus-visible": `color-mix(in srgb, ${tokens.onAccent} 16%, ${tokens.transparent})`,
    },
    color: tokens.onAccent,
    fontSize: "inherit",
    fontWeight: "inherit",
  },
  endCap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    margin: { default: "8px 16px 16px 52px", [narrow]: "8px 8px 16px 38px" },
    padding: "12px 16px",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: tokens.ruleSoft,
    borderRadius: "8px",
    color: tokens.inkMuted,
    fontSize: "11px",
    fontWeight: 700,
  },
  endCapButton: {
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
    boxShadow: "none",
    color: tokens.accent,
    font: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  scrollTail: {
    flexShrink: 0,
  },
  stop: {
    display: "grid",
    gridTemplateColumns: {
      default: "56px minmax(0, 1fr)",
      [narrow]: "38px minmax(0, 1fr)",
    },
    paddingRight: { default: "16px", [narrow]: "8px" },
  },
  rail: {
    position: "relative",
    display: "flex",
    justifyContent: "center",
    "::before": {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: { default: "29px", [narrow]: "19px" },
      width: "2px",
      backgroundColor: tokens.ruleSoft,
      content: "''",
    },
  },
  railNumber: {
    zIndex: 1,
    display: "grid",
    placeItems: "center",
    width: "26px",
    height: "26px",
    marginTop: "18px",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: "50%",
    backgroundColor: tokens.bg,
    boxShadow: `0 0 0 4px ${tokens.bg}`,
    color: tokens.inkFaint,
    fontSize: "12px",
    fontWeight: 700,
  },
  railNumberActive: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    color: tokens.onAccent,
  },
  main: {
    minWidth: 0,
    paddingTop: "16px",
    paddingRight: 0,
    paddingBottom: "22px",
    paddingLeft: { default: "4px", [narrow]: 0 },
  },
  mainActive: {
    borderRadius: "9px",
  },
  // The stop's content breaks out over the rail to the panel's inner edge.
  content: {
    position: "relative",
    zIndex: 2,
    width: { default: "calc(100% + 50px)", [narrow]: "calc(100% + 30px)" },
    marginLeft: {
      default: "calc(-1 * 50px)",
      [narrow]: "calc(-1 * 30px)",
    },
    backgroundColor: tokens.bg,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "14px",
    marginBottom: "12px",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  title: {
    margin: "3px 0 0",
    color: tokens.ink,
    fontSize: "19px",
    lineHeight: "24px",
  },
  titleActive: {
    color: tokens.accent,
  },
  detail: {
    margin: "6px 0 0",
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: "11px",
    lineHeight: "15px",
  },
});
