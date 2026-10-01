import * as stylex from "@stylexjs/stylex";

import { fontSize, motion, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

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
    gap: "14px",
    minHeight: 0,
    padding: "20px 16px 16px",
    overflowY: "auto",
  },
  caps: {
    fontFamily: tokens.fontMono,
    lineHeight: "14px",
  },
  selection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    margin: 0,
  },
  selectionCaption: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  selectionQuote: {
    display: "-webkit-box",
    margin: 0,
    paddingLeft: "12px",
    overflow: "hidden",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.accent,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    fontStyle: "italic",
    lineHeight: "22px",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  error: {
    margin: 0,
    color: tokens.changeRemoved,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "18px",
    whiteSpace: "pre-wrap",
  },
  errorAction: {
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
    color: tokens.ink,
    font: "inherit",
    textDecorationLine: "underline",
    textUnderlineOffset: "3px",
    cursor: "pointer",
    borderRadius: radius.small,
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
  // A loading shimmer; sites set the gradient and its size.
  sweep: {
    animationName: { default: sweep, [reducedMotion]: "none" },
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
