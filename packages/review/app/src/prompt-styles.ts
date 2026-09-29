import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

// The prompt card and the connect card: a segmented row of tabs, the prompt
// quoted under them, and the copy action.
export const promptStyles = stylex.create({
  // A segmented control that hugs its tabs.
  tabs: {
    width: "fit-content",
    maxWidth: "100%",
    marginBottom: "10px",
  },
  // The prompt is the artifact, not chrome: a quote rule separates it from
  // the step's own copy without putting the card frame back.
  body: {
    margin: 0,
    padding: "2px 0 2px 14px",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.reviewHomeRuleSoft,
    color: tokens.ink,
    font: `13px/22px ${tokens.fontMono}`,
    // Prose, not code: keep a last word off its own line if the copy grows.
    textWrap: "pretty",
    whiteSpace: "pre-wrap",
    userSelect: "text",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "18px 0 4px",
  },
  copy: {
    display: "inline-flex",
    gap: "6px",
    alignItems: "center",
    padding: "6px 14px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: "6px",
    color: tokens.onAccent,
    backgroundColor: tokens.accent,
    font: `500 12px/16px ${tokens.fontMono}`,
    textDecoration: "none",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "2px" },
  },
  error: {
    margin: "10px 0 0",
    color: tokens.changeRemoved,
    fontSize: "12px",
    whiteSpace: "pre-wrap",
  },
});
