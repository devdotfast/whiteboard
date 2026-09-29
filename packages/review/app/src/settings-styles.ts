import * as stylex from "@stylexjs/stylex";

// Settings page: flat rows, no cards. One narrow column, a small-caps label per
// section, and a fixed right lane so every control lines up. Shared with the
// diffr section, which lays its rows out the same way.
export const settingsStyles = stylex.create({
  page: {
    width: "min(820px, 100%)",
  },
  lede: {
    margin: "0 0 28px",
    color: "var(--review-home-meta)",
    fontSize: "13px",
  },
  section: {
    marginBottom: "28px",
  },
  sectionLabel: {
    margin: "0 0 2px",
    paddingBottom: "6px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--review-home-rule)",
    color: "var(--review-home-meta)",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 200px",
    alignItems: "center",
    gap: "24px",
    padding: "14px 0",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "var(--review-home-rule-soft)",
  },
  rowText: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    minWidth: 0,
  },
  rowLabel: {
    color: "var(--ink)",
    fontSize: "13px",
  },
  rowDescription: {
    color: "var(--review-home-meta)",
    fontSize: "12px",
  },
  rowControl: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  button: {
    padding: "4px 10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--review-home-rule-soft)",
    borderRadius: "5px",
    color: "inherit",
    backgroundColor: "var(--transparent)",
    font: "inherit",
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: null, ":disabled": 0.5 },
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: "var(--review-home-meta)",
    fontSize: "12px",
    cursor: "pointer",
  },
  // A box is the state of a thing (viewed, enabled); it is the same 14px
  // hairline box everywhere, filled with the accent when checked.
  checkbox: {
    width: "14px",
    height: "14px",
    margin: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: "var(--rule-soft)", ":checked": "var(--accent)" },
    borderRadius: "3px",
    backgroundColor: { default: "var(--surface)", ":checked": "var(--accent)" },
    backgroundImage: { default: "none", ":checked": "var(--check-mark)" },
    backgroundPosition: "center",
    backgroundSize: "10px 10px",
    backgroundRepeat: "no-repeat",
    appearance: "none",
    cursor: "pointer",
  },
  input: {
    minWidth: "200px",
    padding: "4px 8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--review-home-rule-soft)",
    borderRadius: "5px",
    color: "inherit",
    backgroundColor: "var(--transparent)",
    font: "inherit",
    opacity: { default: null, ":disabled": 0.5 },
  },
  diffr: {
    marginTop: "8px",
    paddingLeft: "12px",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: "var(--review-home-rule-soft)",
  },
  diffrSummary: {
    cursor: "pointer",
    paddingBlock: "8px",
  },
  unavailable: {
    color: "var(--review-home-meta)",
    fontSize: "12px",
  },
  error: {
    margin: "4px 0 0",
    color: "var(--change-removed)",
    fontSize: "12px",
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
  summaryResult: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
});
