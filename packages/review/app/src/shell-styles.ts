import { fontSize, motion } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";

import { appMarker, topbarActionsMarker } from "./markers.stylex";
import { tokens } from "./tokens.stylex";

// The app shell: grid, side-panel dividers, top bar and view regions.
const narrowCanvas = "@container review-canvas (max-width: 929px)";

const narrowViewport = "@media (max-width: 720px)";

const narrowContent = "@container review-content (max-width: 720px)";

const peekOpen = () => stylex.when.ancestor("[data-peek-open]", appMarker);

const inTopbarActions = () =>
  stylex.when.ancestor(":is(*)", topbarActionsMarker);

const noBorder = {
  borderWidth: 0,
  borderStyle: "none",
  borderColor: "currentcolor",
} as const;

export const shellStyles = stylex.create({
  // Narrow layouts dock the panel to the bottom half of the canvas as a
  // sheet, so the peek column collapses.
  appPeekOpen: {
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 10px var(--side-peek-width, 560px)",
      [narrowCanvas]: {
        default: "minmax(0, 1fr) 0 0",
        [narrowViewport]: "minmax(0, 1fr)",
      },
      [narrowViewport]: "minmax(0, 1fr)",
    },
  },
  // Lit on the separator itself: a condition on the root would restyle the
  // whole canvas as a drag starts and ends.
  peekResizerActive: {
    "::before": { backgroundColor: tokens.inkFaint },
  },
  // No inherited cursor or user-select here, for the same reason; the
  // separator's pointer capture keeps its cursor and blocks selection.
  appResizing: {
    transition: "none",
  },
  appRestoredPanel: {
    transition: "none",
  },
  apiCanvas: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
  },
  documentShell: {
    position: "relative",
    display: "grid",
    // The explicit minmax(0, 1fr) column lets rows shrink below their
    // min-content width (e.g. wide diagrams) when the panel narrows the
    // shell, instead of overflowing under the side panel.
    gridTemplateColumns: "minmax(0, 1fr)",
    gridTemplateRows: "auto minmax(0, 1fr)",
    minWidth: 0,
    height: "100%",
    overflow: "hidden",
    container: "review-content / inline-size",
  },
  documentShellHistorical: {
    gridTemplateRows: "auto auto minmax(0, 1fr)",
  },
  // The host's own box lives in the collapsed third grid column on narrow
  // layouts; dissolving it lets the sheet position against the app instead
  // of a 0-width, overflow-hidden ancestor.
  detailHost: {
    position: "relative",
    display: {
      default: "grid",
      [narrowCanvas]: "contents",
      [narrowViewport]: "contents",
    },
    minWidth: 0,
    height: "100%",
    overflow: "hidden",
  },

  // The vertical divider between a pane and its side panel.
  resizer: {
    position: "relative",
    display: {
      default: null,
      [peekOpen()]: {
        default: null,
        [narrowCanvas]: "none",
        [narrowViewport]: "none",
      },
    },
    width: "10px",
    minWidth: "10px",
    zIndex: 1,
    cursor: "col-resize",
    backgroundColor: tokens.transparent,
    ...noBorder,
    touchAction: "none",
    outline: {
      default: null,
      ":focus-visible": `1px solid ${tokens.ruleSoft}`,
    },
    outlineOffset: { default: null, ":focus-visible": "-1px" },
    "::before": {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: "50%",
      width: {
        default: "1px",
        ":hover": "3px",
        ":focus-visible": "3px",
        ":active": "3px",
      },
      backgroundColor: {
        default: tokens.rule,
        ":hover": tokens.inkFaint,
        ":focus-visible": tokens.inkFaint,
        ":active": tokens.inkFaint,
      },
      transform: "translateX(-50%)",
      transitionProperty: "width, background-color",
      transitionDuration: motion.fast,
      // Passing over a divider does not flash it.
      transitionDelay: { default: motion.instant, ":hover": motion.fast },
      content: "''",
    },
  },
  // Rule flush left; grabs rightward over the panel's padding, never the
  // scrollbar.
  resizerGrabPanel: {
    "::before": { left: 0, transform: "none" },
    "::after": {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      right: "-8px",
      content: "''",
    },
  },
  // The column continues the panel and its header.
  peekResizer: {
    height: "100%",
    borderColor: tokens.transparent,
    backgroundImage: `linear-gradient(${tokens.surface} calc(${tokens.reviewHeaderHeight} - 1px), ${tokens.rule} 0 ${tokens.reviewHeaderHeight}, ${tokens.transparent} 0)`,
  },
  peekResizerTray: {
    backgroundColor: tokens.tray,
    backgroundImage: `linear-gradient(${tokens.transparent} calc(${tokens.reviewHeaderHeight} - 1px), ${tokens.rule} 0 ${tokens.reviewHeaderHeight}, ${tokens.transparent} 0)`,
  },
  // Horizontal twin of the divider for the narrow-layout bottom sheet: it
  // drags the sheet height. Hidden on wide layouts, where the vertical
  // divider owns resizing.
  sheetResizer: {
    position: "relative",
    display: {
      default: "none",
      [narrowCanvas]: "block",
      [narrowViewport]: "block",
    },
    flex: "0 0 auto",
    height: "10px",
    minHeight: "10px",
    cursor: "row-resize",
    backgroundColor: tokens.transparent,
    ...noBorder,
    touchAction: "none",
    outline: {
      default: null,
      ":focus-visible": `1px solid ${tokens.ruleSoft}`,
    },
    outlineOffset: { default: null, ":focus-visible": "-1px" },
    "::before": {
      position: "absolute",
      top: "50%",
      right: 0,
      left: 0,
      height: "1px",
      backgroundColor: {
        default: tokens.rule,
        ":hover": tokens.inkFaint,
        ":focus-visible": tokens.inkFaint,
      },
      transform: "translateY(-50%)",
      content: "''",
    },
  },

  topbar: {
    position: "sticky",
    top: 0,
    zIndex: tokens.reviewDebugLayer,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    height: tokens.reviewHeaderHeight,
    padding: "0 12px 0 16px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.surface,
  },
  topbarLeft: {
    display: "flex",
    flex: "0 0 auto",
    alignItems: "center",
  },
  topbarActions: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flex: "1 1 auto",
    minWidth: 0,
    height: "100%",
    overflowX: "auto",
  },
  // Every item in the action row keeps its size.
  topbarItem: {
    flex: { default: null, [inTopbarActions()]: "0 0 auto" },
  },
  // Popovers in the action row hang below their control, anchored by
  // useAnchoredPopover.
  topbarPopover: {
    position: { default: null, [inTopbarActions()]: "fixed" },
    top: { default: null, [inTopbarActions()]: "calc(anchor(bottom) + 4px)" },
    right: { default: null, [inTopbarActions()]: "anchor(right)" },
    bottom: { default: null, [inTopbarActions()]: "auto" },
    left: { default: null, [inTopbarActions()]: "auto" },
    margin: { default: null, [inTopbarActions()]: 0 },
    maxWidth: { default: null, [inTopbarActions()]: "calc(100vw - 16px)" },
    positionTryFallbacks: {
      default: null,
      [inTopbarActions()]: "flip-inline, flip-block",
    },
    positionVisibility: {
      default: null,
      [inTopbarActions()]: "anchors-visible",
    },
  },
  // The scratchpad has no source tree or pins to set apart, so no rule.
  topbarContext: {
    display: "flex",
    flex: "0 0 auto",
    minWidth: 0,
    alignItems: "center",
    marginRight: "auto",
    "::before": {
      display: { default: null, ":empty": "none" },
      content: "''",
      flex: "0 0 1px",
      height: "20px",
      margin: "0 14px 0 16px",
      backgroundColor: tokens.chromeBorder,
    },
  },
  // The top bar compacts against its own column (the shell container), not
  // the viewport: an open side panel narrows the column without resizing
  // the window. In a narrow column this ghost Button drops its label.
  openSourceTree: {
    justifyContent: { default: null, [narrowContent]: "center" },
    width: { default: null, [narrowContent]: tokens.chromeControlHeight },
    padding: { default: "0 10px", [narrowContent]: 0 },
  },
  openSourceTreeLabel: {
    display: { default: null, [narrowContent]: "none" },
  },
  actionsDivider: {
    flexShrink: 0,
    width: "1px",
    height: "16px",
    backgroundColor: tokens.chromeBorder,
  },
  historyBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "6px 12px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
    backgroundColor: `color-mix(in srgb, ${tokens.accent} 12%, ${tokens.surface})`,
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
  },

  viewRegion: {
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  commitsRegion: {
    overflow: "auto",
  },
  // --review-toc-tail is the room the contents rail adds so the last heading
  // can scroll up to the top edge, measured by the rail itself.
  reviewRegion: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 0,
    minWidth: 0,
    overflowX: "hidden",
    overflowY: "auto",
    // Let macOS hide the document scrollbar when idle.
    scrollbarWidth: "thin",
    padding: {
      default: `${tokens.reviewPageTop} 52px calc(max(120px, var(--review-bottom-scroll-padding, 0px)) + var(--review-toc-tail, 0px))`,
      "@container review-content (max-width: 1180px)": {
        default: `${tokens.reviewPageTop} 42px 120px`,
        "@container review-content (max-width: 1080px)": {
          default: `${tokens.reviewPageTop} 24px 120px`,
          [narrowViewport]: "22px 8px calc(96px + var(--review-toc-tail, 0px))",
        },
      },
      [narrowViewport]: "22px 8px calc(96px + var(--review-toc-tail, 0px))",
    },
  },
  documentView: {
    display: "contents",
  },
  hidden: {
    display: "none",
  },
  mapView: {
    position: "relative",
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr)",
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
  },
  // Anchors the floating map settings control.
  mapCanvasShell: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gridRow: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  diffView: {
    position: "relative",
    display: "grid",
    gridTemplateRows: "minmax(0, 1fr)",
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
  },
  // Keep the full diff alive while another view is selected. It initializes
  // in the review page's loading window, then the first Diff click and every
  // return reuse the same file tree, editor models, selection, and scroll
  // state.
  diffViewPreloaded: {
    position: "absolute",
    inset: 0,
    opacity: 0,
    visibility: "hidden",
    pointerEvents: "none",
  },
  diffViewScoped: {
    gridTemplateRows: "30px minmax(0, 1fr)",
  },
});
