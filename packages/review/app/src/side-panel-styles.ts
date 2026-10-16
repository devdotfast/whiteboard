import * as stylex from "@stylexjs/stylex";

import { detailHostMarker } from "./markers.stylex";
import {
  elevation,
  fontSize,
  fontWeight,
  layer,
  leading,
  motion,
  radius,
  space,
} from "./scale.stylex";
import { tokens } from "./tokens.stylex";

const narrowCanvas = "@container review-canvas (max-width: 929px)";

const short = "@media (max-height: 560px)";

// A stop's rail column. The stop's content breaks out over it, and on narrow
// panels the end cap lines up past it.
const RAIL = "56px";

const RAIL_NARROW = "38px";

// The panel's own grid cell in App's detail host.
const inDetailHost = () => stylex.when.ancestor(":is(*)", detailHostMarker);

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
    // Positioned at every width: the body's overlay scrollbar sits in it.
    position: {
      default: "relative",
      [narrowCanvas]: "absolute",
      [stylex.env.narrow]: "absolute",
    },
    inset: {
      default: null,
      [narrowCanvas]: { default: "auto 0 0 0", [short]: 0 },
      [stylex.env.narrow]: { default: "auto 0 0 0", [short]: 0 },
      [short]: 0,
    },
    zIndex: {
      default: null,
      [narrowCanvas]: layer.sheet,
      [stylex.env.narrow]: layer.sheet,
    },
    height: {
      default: "100%",
      [narrowCanvas]: { default: sheetHeight, [short]: "100%" },
      [stylex.env.narrow]: { default: sheetHeight, [short]: "100%" },
    },
    maxHeight: {
      default: null,
      [narrowCanvas]: { default: "100%", [short]: "none" },
      [stylex.env.narrow]: { default: "100%", [short]: "none" },
      [short]: "none",
    },
    gridArea: { default: null, [inDetailHost()]: "1 / 1" },
    overflow: "hidden",
    backgroundColor: tokens.bg,
    animationName: { default: slideIn, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: motion.medium,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "ease-out",
      [stylex.env.reducedMotion]: "ease",
    },
  },
  restored: {
    animationName: "none",
    animationDuration: motion.instant,
    animationTimingFunction: "ease",
  },
  // Inside a diagram tour the panel keeps its column at every width.
  docked: {
    position: "relative",
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
    gap: space.s12,
    minHeight: tokens.reviewHeaderHeight,
    padding: `0 ${space.s10} 0 ${space.s16}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.surface,
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    minWidth: 0,
  },
  kicker: {
    flex: "0 0 auto",
    fontFamily: tokens.fontMono,
  },
  heading: {
    margin: 0,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.ui,
    fontWeight: fontWeight.semibold,
    lineHeight: leading.tight,
  },
  close: {
    flex: "0 0 auto",
  },
  actions: {
    display: "flex",
    flex: "0 0 auto",
    alignItems: "center",
    gap: space.s2,
  },
  // A conversation sits on the tray, header and all.
  tray: {
    backgroundColor: tokens.tray,
  },
  trayKicker: {
    color: tokens.inkMuted,
    fontSize: fontSize.small,
    fontWeight: fontWeight.regular,
  },
  // The conversation scrolls its own thread; the composer stays put.
  trayBody: {
    display: "flex",
    flexDirection: "column",
    paddingBottom: 0,
    overflow: "hidden",
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
    padding: { default: space.s12, [stylex.env.narrow]: space.s8 },
  },
  peekActions: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: space.s12,
  },
  peekContent: {
    minWidth: 0,
  },
  // Peek content runs to the column's edges; text and actions keep the
  // panel's inset.
  peekText: {
    paddingInline: { default: space.s16, [stylex.env.narrow]: space.s8 },
  },
  inset: {
    padding: {
      default: `${space.s12} ${space.s12} 0`,
      [stylex.env.narrow]: `${space.s8} ${space.s8} 0`,
    },
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
    padding: `0 0 ${space.s72}`,
    scrollPaddingTop: "18px",
    scrollPaddingBottom: "72px",
  },
  floatingFooter: {
    position: "absolute",
    right: 0,
    bottom: { default: space.s12, [stylex.env.narrow]: space.s8 },
    left: 0,
    zIndex: 4,
    display: "flex",
    justifyContent: "center",
    padding: {
      default: `0 ${space.s12}`,
      [stylex.env.narrow]: `0 ${space.s8}`,
    },
    pointerEvents: "none",
  },
  pill: {
    borderRadius: radius.pill,
    boxShadow: elevation.popover,
    fontSize: fontSize.small,
    fontWeight: fontWeight.bold,
    pointerEvents: "auto",
  },
  pillIntro: {
    padding: `0 ${space.s14}`,
  },
  pillGroup: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    padding: `${space.s4} ${space.s10}`,
    backgroundColor: tokens.accent,
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
    gap: space.s12,
    margin: {
      default: `${space.s16} ${space.s16} ${space.s16} ${space.s48}`,
      [stylex.env.narrow]:
        `${space.s16} ${space.s8} ${space.s16} ${RAIL_NARROW}`,
    },
    padding: `${space.s12} ${space.s16}`,
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.surface,
    color: tokens.inkMuted,
    fontSize: fontSize.small,
    fontWeight: fontWeight.bold,
  },
  scrollTail: {
    flexShrink: 0,
  },
  stop: {
    display: "grid",
    gridTemplateColumns: {
      default: `${RAIL} minmax(0, 1fr)`,
      [stylex.env.narrow]: `${RAIL_NARROW} minmax(0, 1fr)`,
    },
    paddingRight: { default: space.s16, [stylex.env.narrow]: space.s8 },
    // The rail's x in the stop, for the rail and its faint runs between a
    // step's code cards.
    "--review-tour-rail-x": {
      default: space.s28,
      [stylex.env.narrow]: space.s18,
    },
  },
  rail: {
    position: "relative",
    display: "flex",
    justifyContent: "center",
    "::before": {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: "var(--review-tour-rail-x)",
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
    marginTop: space.s18,
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.round,
    backgroundColor: tokens.bg,
    boxShadow: `0 0 0 4px ${tokens.bg}`,
    color: tokens.inkFaint,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
  },
  railNumberActive: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    color: tokens.onAccent,
  },
  main: {
    minWidth: 0,
    paddingTop: space.s16,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: { default: space.s4, [stylex.env.narrow]: 0 },
  },
  mainActive: {
    borderRadius: radius.surface,
  },
  // The stop's content breaks out over the rail and the stop's right padding
  // to run edge to edge; the rail stops where it starts.
  content: {
    position: "relative",
    zIndex: 2,
    width: {
      default: "calc(100% + 76px)",
      [stylex.env.narrow]: "calc(100% + 46px)",
    },
    marginLeft: {
      default: `calc(-1 * (${RAIL} + ${space.s4}))`,
      [stylex.env.narrow]: `-${RAIL_NARROW}`,
    },
    backgroundColor: tokens.bg,
    // A step's code cards stand apart; a lone peek's stay flush.
    "--review-code-card-gap": "12px",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space.s14,
    marginBottom: space.s12,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
  },
  title: {
    margin: `${space.s4} 0 0`,
    color: tokens.ink,
    fontSize: fontSize.heading,
    lineHeight: leading.px24,
  },
  titleActive: {
    color: tokens.accent,
  },
  detail: {
    margin: `${space.s6} 0 0`,
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: leading.px16,
  },
});
