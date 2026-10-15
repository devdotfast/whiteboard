import {
  fontSize,
  fontWeight,
  leading,
  radius,
  space,
} from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

// The prompt card and the connect card: a segmented row of tabs, the prompt
// quoted under them, and the copy action.
export const promptStyles = stylex.create({
  // A segmented control that hugs its tabs.
  tabs: {
    width: "fit-content",
    maxWidth: "100%",
    marginBottom: space.s10,
  },
  // The prompt is the artifact, not chrome: a quote rule separates it from
  // the step's own copy without putting the card frame back.
  body: {
    margin: 0,
    padding: `${space.s2} 0 ${space.s2} ${space.s14}`,
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.ruleSoft,
    color: tokens.ink,
    font: `${fontSize.ui}/${leading.px22} ${tokens.fontMono}`,
    // Prose, not code: keep a last word off its own line if the copy grows.
    textWrap: "pretty",
    whiteSpace: "pre-wrap",
    userSelect: "text",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    padding: `${space.s18} 0 ${space.s4}`,
  },
  copy: {
    display: "inline-flex",
    gap: space.s6,
    alignItems: "center",
    padding: `${space.s6} ${space.s14}`,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: radius.control,
    color: tokens.onAccent,
    backgroundColor: tokens.accent,
    font: `${fontWeight.medium} ${fontSize.body}/${leading.px16} ${tokens.chromeFont}`,
    textDecoration: "none",
  },
  error: {
    margin: `${space.s10} 0 0`,
    fontSize: fontSize.body,
    whiteSpace: "pre-wrap",
  },
});
