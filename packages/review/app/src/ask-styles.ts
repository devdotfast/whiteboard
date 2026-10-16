import * as stylex from "@stylexjs/stylex";

import { fontSize, leading, motion, radius, space } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

const sweep = stylex.keyframes({
  from: { backgroundPosition: "100% 0" },
  to: { backgroundPosition: "-100% 0" },
});

// What the Ask panel's pages share: their layout, lists, errors and the
// quote of the selection asked about.
export const askPanelStyles = stylex.create({
  body: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    minHeight: 0,
  },
  // A page of the panel that scrolls on its own: the history or the setup.
  page: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    gap: space.s14,
    minHeight: 0,
    padding: `${space.s20} ${space.s16} ${space.s16}`,
    overflowY: "auto",
  },
  caps: {
    fontFamily: tokens.fontMono,
    lineHeight: leading.px14,
  },
  selection: {
    display: "flex",
    flexDirection: "column",
    gap: space.s8,
    margin: 0,
  },
  selectionQuote: {
    margin: 0,
    paddingLeft: space.s12,
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.accent,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    fontStyle: "italic",
    lineHeight: leading.px22,
  },
  error: {
    margin: 0,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: leading.px18,
    whiteSpace: "pre-wrap",
  },
  // A loading shimmer; sites set the gradient and its size.
  sweep: {
    animationName: { default: sweep, [stylex.env.reducedMotion]: "none" },
    animationDuration: motion.pulse,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  // A bordered list of rows: the saved conversations, or the agents to set up.
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: 0,
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    listStyle: "none",
  },
  listItem: {
    borderTopWidth: { default: 0, ":not(:first-child)": "1px" },
    borderTopStyle: { default: "none", ":not(:first-child)": "solid" },
    borderTopColor: tokens.rule,
  },
});
