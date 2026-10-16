import { fontSize } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

// Settings page: flat rows, no cards. One narrow column, a small-caps label per
// section, and a fixed right lane so every control lines up. Shared with the
// diffr section, which lays its rows out the same way.
export const settingsStyles = stylex.create({
  page: {
    width: "min(820px, 100%)",
  },
  lede: {
    margin: "0 0 28px",
    color: tokens.inkMuted,
    fontSize: fontSize.ui,
  },
  section: {
    marginBottom: "28px",
  },
  sectionLabel: {
    margin: "0 0 2px",
    paddingBottom: "6px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    color: tokens.inkMuted,
  },
  connect: {
    paddingBlock: "14px",
  },
  row: {
    display: "grid",
    // Wide segmented controls grow the lane instead of overlapping the text.
    gridTemplateColumns: "minmax(0, 1fr) minmax(200px, max-content)",
    alignItems: "center",
    gap: "24px",
    padding: "14px 0",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
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
    gap: "8px",
    color: tokens.inkMuted,
    fontSize: fontSize.body,
    cursor: "pointer",
  },
  input: {
    minWidth: "200px",
  },
  diffr: {
    marginTop: "8px",
    paddingLeft: "12px",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.ruleSoft,
  },
  diffrSummary: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    paddingBlock: "8px",
  },
  unavailable: {
    color: tokens.inkMuted,
    fontSize: fontSize.body,
  },
  error: {
    margin: "4px 0 0",
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
    gap: "8px",
  },
  prompt: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    marginTop: "8px",
  },
  summaryResult: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});
