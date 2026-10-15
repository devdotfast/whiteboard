import * as stylex from "@stylexjs/stylex";

import {
  traceGroupMarker,
  traceRowMarker,
  traceToolMarker,
  traceWorkedMarker,
} from "./markers.stylex";
import {
  elevation,
  fontSize,
  fontWeight,
  leading,
  motion,
  radius,
  space,
} from "./scale.stylex";
import { tokens } from "./tokens.stylex";

// The agent trace view, and the trace scoped into a side peek.
export const traceStyles = stylex.create({
  region: {
    overflow: "auto",
    // The trace view anchors scroll itself across elision changes; the
    // browser's own heuristic would otherwise adjust a second time.
    overflowAnchor: "none",
  },
  view: {
    minHeight: "100%",
    // The left inset clears the event ruler: 14px edge inset + 6px resting
    // tick + 28px gap, so the 30px hover comb stops just short of the text.
    padding: `${space.s36} ${space.s24} ${space.s96} ${space.s48}`,
  },
  column: {
    width: "min(980px, 100%)",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
  },
  kicker: {
    fontFamily: tokens.chromeFont,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.s10,
    paddingBottom: space.s24,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
  },
  title: {
    margin: 0,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.display,
    lineHeight: leading.px28,
    fontWeight: fontWeight.medium,
    color: tokens.ink,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s8,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    color: tokens.inkFaint,
  },
  metaSeparator: {
    color: tokens.ruleSoft,
  },

  picker: {
    position: "relative",
    display: "inline-block",
    marginBottom: space.s20,
  },
  // A secondary Button that stands off the page like a select.
  pickerTrigger: {
    justifyContent: "flex-start",
    gap: space.s8,
    maxWidth: "min(680px, 100%)",
    borderColor: { default: tokens.rule, ":hover": tokens.ruleSoft },
    backgroundColor: { default: tokens.surface, ":hover": tokens.tray },
    color: tokens.ink,
    fontWeight: fontWeight.regular,
    boxShadow: elevation.raised,
  },
  pickerTriggerOpen: {
    borderColor: tokens.accent,
    boxShadow: `0 0 0 2px ${tokens.accentWash}`,
  },
  pickerHarness: {
    fontFamily: tokens.chromeFont,
    color: tokens.accent,
    flexShrink: 0,
  },
  pickerTitle: {
    fontWeight: fontWeight.medium,
    color: tokens.ink,
  },
  pickerChevron: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "12px",
    height: "12px",
    marginLeft: space.s2,
    flexShrink: 0,
    color: tokens.inkFaint,
    transition: `transform ${motion.fast} ${motion.ease}`,
  },
  pickerChevronOpen: {
    transform: "rotate(180deg)",
  },
  pickerMenu: {
    minWidth: "320px",
    maxWidth: "min(640px, 90vw)",
  },
  pickerItemSubagent: {
    paddingLeft: space.s20,
  },
  pickerItemHarness: {
    fontFamily: tokens.chromeFont,
    color: tokens.inkMuted,
    flexShrink: 0,
    minWidth: "52px",
  },
  pickerItemHarnessActive: {
    color: tokens.accent,
  },
  pickerItemBadge: {
    flex: "none",
    marginLeft: "auto",
    backgroundColor: tokens.tray,
    color: tokens.inkFaint,
  },

  events: {
    display: "flex",
    flexDirection: "column",
    gap: space.s18,
    marginTop: space.s28,
  },
  // In a side peek.
  eventsScoped: {
    marginTop: "22px",
  },
  turn: {
    display: "flex",
    flexDirection: "column",
    gap: space.s18,
  },
  // An elided message sets its own prose; a whole one leaves it to markdown.
  proseElided: {
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: leading.px26,
    color: tokens.ink,
  },
  proseMarkdown: {
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: leading.px26,
    color: tokens.ink,
    overflowWrap: "anywhere",
  },

  tool: {
    minWidth: 0,
  },
  toolRow: {
    display: "grid",
    gridTemplateColumns: "20px minmax(0, 1fr) 16px",
    columnGap: space.s6,
    alignItems: "center",
    minHeight: "24px",
  },
  icon: {
    color: tokens.inkFaint,
  },
  centered: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  toolLabel: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s6,
    minWidth: 0,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "19px",
  },
  toolVerb: {
    color: tokens.inkFaint,
    flexShrink: 0,
  },
  toolTitle: {
    color: tokens.inkMuted,
  },
  toolTitleFile: {
    color: tokens.accent,
    // Ellipsize the FRONT of paths so the filename stays visible.
    direction: "rtl",
    textAlign: "left",
  },
  toolPath: {
    unicodeBidi: "plaintext",
  },
  added: {
    color: tokens.changeAdded,
    flexShrink: 0,
  },
  removed: {
    color: tokens.changeRemoved,
    flexShrink: 0,
  },
  errorFlag: {
    flexShrink: 0,
  },

  // The embedded workbench Chromium does not hide closed details content.
  figure: {
    display: {
      default: null,
      [stylex.when.ancestor(":not([open])", traceToolMarker)]: "none",
    },
    margin: `${space.s10} 0 0 26px`,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.surface,
    overflow: "hidden",
  },
  figureHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "30px",
    padding: `0 ${space.s12}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.tray,
    fontFamily: tokens.chromeFont,
  },
  figureBody: {
    display: "flex",
    flexDirection: "column",
    gap: space.s10,
    margin: 0,
    padding: `${space.s14} ${space.s16}`,
    maxHeight: "420px",
    overflow: "auto",
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: leading.px20,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  },
  figureBodyThinking: {
    whiteSpace: "normal",
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: leading.px22,
    color: tokens.inkMuted,
  },
  thinkingMarkdown: {
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    color: "inherit",
  },
  figureCommand: {
    color: tokens.ink,
  },
  figureOutput: {
    color: tokens.inkMuted,
  },

  workedSummary: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    margin: `${space.s6} 0 0`,
    fontFamily: tokens.chromeFont,
    color: { default: tokens.inkFaint, ":hover": tokens.inkMuted },
  },
  inlineCentered: {
    display: "inline-flex",
    alignItems: "center",
  },
  line: {
    flexGrow: 1,
    height: "1px",
    backgroundColor: tokens.rule,
  },
  workedBody: {
    display: {
      default: "flex",
      [stylex.when.ancestor(":not([open])", traceWorkedMarker)]: "none",
    },
    flexDirection: "column",
    gap: space.s18,
    marginTop: space.s18,
  },

  // Coalesced tool runs: one summary row per consecutive tool-call run.
  toolGroupSummary: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    minHeight: "24px",
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    color: tokens.inkMuted,
  },
  toolGroupLabel: {
    color: tokens.inkMuted,
  },
  toolGroupCount: {
    color: tokens.inkFaint,
    fontSize: fontSize.small,
  },
  toolGroupBody: {
    display: {
      default: "flex",
      [stylex.when.ancestor(":not([open])", traceGroupMarker)]: "none",
    },
    flexDirection: "column",
    gap: space.s18,
    padding: `${space.s2} 0 ${space.s4} 26px`,
  },

  note: {
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "19px",
    color: tokens.inkFaint,
  },
  // The empty notice starts where a trace's header would.
  empty: {
    paddingTop: space.s48,
  },

  // Lens rows. A gap row marks hidden events with dashes; a collapse row,
  // solid, marks the boundary of a revealed span.
  lensRow: {
    display: "flex",
    alignItems: "center",
    gap: space.s10,
    margin: `${space.s4} 0`,
    padding: 0,
    cursor: "pointer",
    width: "100%",
  },
  lensLine: {
    flexGrow: 1,
    height: "1px",
    borderTopWidth: "1px",
    borderTopStyle: "dashed",
    borderTopColor: tokens.ruleSoft,
  },
  lensLineSolid: {
    borderTopStyle: "solid",
    borderColor: {
      default: null,
      [stylex.when.ancestor(":hover", traceRowMarker)]: tokens.inkFaint,
    },
    borderTopColor: {
      default: tokens.ruleSoft,
      [stylex.when.ancestor(":hover", traceRowMarker)]: tokens.inkFaint,
    },
  },
  lensRowChip: {
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: {
      default: tokens.ruleSoft,
      [stylex.when.ancestor(":hover", traceRowMarker)]: tokens.inkFaint,
    },
    backgroundColor: tokens.surface,
    fontFamily: tokens.chromeFont,
    color: {
      default: tokens.inkFaint,
      [stylex.when.ancestor(":hover", traceRowMarker)]: tokens.inkMuted,
    },
  },
  lensRowChipSolid: {
    borderStyle: "solid",
  },
  collapseChevron: {
    width: "10px",
    height: "10px",
  },
  userSlot: {
    display: "flex",
    flexDirection: "column",
    gap: space.s18,
    width: "100%",
  },
  elided: {
    display: "inline",
  },
  kept: {
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: leading.px26,
    color: tokens.ink,
  },
  keptInBubble: {
    lineHeight: leading.px24,
  },
  lensChip: {
    margin: `0 ${space.s6}`,
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: { default: tokens.ruleSoft, ":hover": tokens.inkFaint },
    backgroundColor: tokens.surface,
    fontFamily: tokens.chromeFont,
    color: { default: tokens.inkFaint, ":hover": tokens.inkMuted },
    cursor: "pointer",
    verticalAlign: "baseline",
  },

  peekOpenFull: {
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
  },
  source: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    margin: "0 0 0.75rem",
  },
});
