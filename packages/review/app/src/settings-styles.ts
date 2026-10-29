import { fontSize, space } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

const narrow = "@container review-canvas (max-width: 980px)";

// Settings page: flat rows, no cards. One narrow column, a small-caps label per
// section, and a fixed right lane so every control lines up. Shared with the
// diffr section, which lays its rows out the same way.
export const settingsStyles = stylex.create({
  layout: {
    display: "grid",
    gridTemplateColumns: {
      default: "160px minmax(0, 820px)",
      [narrow]: "minmax(0, 820px)",
    },
    justifyContent: "center",
    alignItems: "start",
    gap: space.s40,
  },
  // Lets Contents scroll the last section to the top.
  scroll: {
    paddingBottom:
      "calc(max(56px, var(--review-bottom-scroll-padding, 0px)) + var(--review-toc-tail, 0px))",
  },
  page: {
    width: "min(820px, 100%)",
  },
  toc: {
    display: { default: "flex", [narrow]: "none" },
    flexDirection: "column",
    gap: space.s2,
    position: "sticky",
    top: 0,
    paddingTop: space.s8,
  },
  lede: {
    margin: `0 0 ${space.s28}`,
    color: tokens.inkMuted,
    fontSize: fontSize.ui,
  },
  section: {
    marginBottom: space.s28,
  },
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    gap: space.s4,
    margin: `0 0 ${space.s2}`,
    paddingBottom: space.s6,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
  },
  sectionHeading: {
    margin: 0,
    color: tokens.inkMuted,
  },
  connect: {
    paddingBlock: space.s14,
  },
  row: {
    display: "grid",
    // Wide segmented controls grow the lane instead of overlapping the text.
    gridTemplateColumns: "minmax(0, 1fr) minmax(200px, max-content)",
    alignItems: "center",
    gap: space.s24,
    padding: `${space.s14} 0`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    minWidth: 0,
  },
  rowLabel: {
    color: tokens.ink,
    fontSize: fontSize.ui,
  },
  rowDescription: {
    color: tokens.inkMuted,
    fontSize: fontSize.body,
  },
  rowControl: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    color: tokens.inkMuted,
    fontSize: fontSize.body,
    cursor: "pointer",
  },
  input: {
    minWidth: "200px",
  },
  nested: {
    marginTop: space.s8,
    paddingLeft: space.s12,
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.ruleSoft,
  },
  nestedSummary: {
    display: "flex",
    alignItems: "center",
    gap: space.s6,
    paddingBlock: space.s8,
  },
  unavailable: {
    color: tokens.inkMuted,
    fontSize: fontSize.body,
  },
  error: {
    margin: `${space.s4} 0 0`,
    fontSize: fontSize.body,
    whiteSpace: "pre-wrap",
  },
  summaryFields: {
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    padding: 0,
    margin: 0,
    minWidth: 0,
  },
  summaryActions: {
    display: "flex",
    gap: space.s8,
  },
  prompt: {
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    marginTop: space.s8,
  },
  summaryResult: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});
