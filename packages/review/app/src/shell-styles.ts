import { motion, space } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";

import { appMarker, topbarActionsMarker } from "./markers.stylex";
import { tocRail } from "./review-toc.stylex";
import { tokens } from "./tokens.stylex";

// The app shell: grid, side-panel dividers, top bar and view regions.
const narrowCanvas = "@container review-canvas (max-width: 929px)";

const narrowContent = "@container review-content (max-width: 720px)";

const peekOpen = () => stylex.when.ancestor("[data-peek-open]", appMarker);

const inTopbarActions = () =>
  stylex.when.ancestor(":is(*)", topbarActionsMarker);

export const shellStyles = stylex.create({
  // Narrow layouts dock the panel to the bottom half of the canvas as a
  // sheet, so the peek column collapses.
  appPeekOpen: {
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 10px var(--side-peek-width, 560px)",
      [narrowCanvas]: {
        default: "minmax(0, 1fr) 0 0",
        [stylex.env.narrow]: "minmax(0, 1fr)",
      },
      [stylex.env.narrow]: "minmax(0, 1fr)",
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
  board: {
    flex: "1 1 auto",
  },
  documentShell: {
    position: "relative",
    display: "grid",
    // The explicit minmax(0, 1fr) column lets rows shrink below their
    // min-content width (e.g. wide diagrams) when the panel narrows the
    // shell, instead of overflowing under the side panel.
    gridTemplateColumns: "minmax(0, 1fr)",
    gridTemplateRows: "minmax(0, 1fr)",
    minWidth: 0,
    height: "100%",
    overflow: "hidden",
    container: "review-content / inline-size",
  },
  documentShellBanner: {
    gridTemplateRows: "auto minmax(0, 1fr)",
  },
  // The host's own box lives in the collapsed third grid column on narrow
  // layouts; dissolving it lets the sheet position against the app instead
  // of a 0-width, overflow-hidden ancestor.
  detailHost: {
    position: "relative",
    display: {
      default: "grid",
      [narrowCanvas]: "contents",
      [stylex.env.narrow]: "contents",
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
        [stylex.env.narrow]: "none",
      },
    },
    width: "10px",
    minWidth: "10px",
    zIndex: 1,
    cursor: "col-resize",
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
      transitionDuration: {
        default: motion.fast,
        [stylex.env.reducedMotion]: motion.instant,
      },
      // Passing over a divider does not flash it.
      transitionDelay: { default: motion.instant, ":hover": motion.fast },
      content: "''",
    },
  },
  // Rule flush right, on the panel's edge, so content that runs edge to edge
  // meets it; grabs rightward into the panel, never the scrollbar.
  resizerGrabPanel: {
    "::before": { left: "auto", right: 0, transform: "none" },
    "::after": {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      right: `-${space.s8}`,
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
      [stylex.env.narrow]: "block",
    },
    flex: "0 0 auto",
    height: "10px",
    minHeight: "10px",
    cursor: "row-resize",
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
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s8,
    height: tokens.reviewHeaderHeight,
    padding: `0 ${space.s12} 0 ${space.s16}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.surface,
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    container: "review-content / inline-size",
    WebkitAppRegion: "drag",
  },
  // Notion's page bar: where you are at the far left, what you can do at
  // the far right, on the page's own surface with no rule under it.
  // In Desktop a collapsed sidebar leaves the window controls over the
  // bar's left end; --review-page-bar-inset clears them.
  // A fullscreen surface's left column runs under those controls too: its
  // header reads --review-fullscreen-inset to clear them as the page bar does.
  clearsWindowControls: {
    "--review-fullscreen-inset": "var(--review-page-bar-inset, 0px)",
  },
  pageBar: {
    height: tokens.reviewPageBarHeight,
    paddingLeft: "calc(16px + var(--review-page-bar-inset, 0px))",
    borderBottomWidth: 0,
  },
  // The breadcrumb takes what the icons leave, and clamps inside it.
  // At the narrowest the breadcrumb clips rather than run under the icons.
  pageBarLeft: {
    flex: "1 1 auto",
    minWidth: 0,
    overflow: "clip",
    overflowClipMargin: "4px",
  },
  pageBarActions: { flex: "0 0 auto", position: "relative" },
  topbarLeft: {
    display: "flex",
    flex: "0 0 auto",
    alignItems: "center",
  },
  topbarActions: {
    display: "flex",
    alignItems: "center",
    gap: space.s10,
    flex: "1 1 auto",
    minWidth: 0,
    height: "100%",
    overflowX: "auto",
  },
  // Every item in the action row keeps its size.
  topbarItem: {
    flex: { default: null, [inTopbarActions()]: "0 0 auto" },
  },
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
  topbarContext: {
    display: "flex",
    flex: "0 1 auto",
    minWidth: 0,
    alignItems: "center",
    marginRight: "auto",
    "::before": {
      display: { default: null, ":empty": "none" },
      content: "''",
      flex: "0 0 1px",
      height: "20px",
      margin: `0 ${space.s14} 0 ${space.s16}`,
      backgroundColor: tokens.chromeBorder,
    },
  },
  // The top bar compacts against its own width, not the viewport. In a
  // narrow bar this ghost Button drops its label.
  openSourceTree: {
    flexShrink: 0,
    justifyContent: { default: null, [narrowContent]: "center" },
    width: { default: null, [narrowContent]: tokens.chromeControlHeight },
    padding: { default: `0 ${space.s10}`, [narrowContent]: 0 },
  },
  openSourceTreeLabel: {
    display: { default: null, [narrowContent]: "none" },
  },

  viewRegion: {
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  // --review-toc-tail is the room below the last heading so Contents can
  // scroll it to the top edge, measured by useHeadingInView.
  reviewRegion: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 0,
    minWidth: 0,
    overflowX: "hidden",
    overflowY: "auto",
    padding: {
      default: `${tokens.reviewPageTop} ${space.s48} calc(max(120px, var(--review-bottom-scroll-padding, 0px)) + var(--review-toc-tail, 0px))`,
      "@container review-content (max-width: 1180px)": {
        default: `${tokens.reviewPageTop} ${space.s40} calc(120px + var(--review-toc-tail, 0px))`,
        // Wide enough for the contents rail to show, this padding widens on
        // the right to keep its gutter clear.
        "@container review-content (max-width: 1080px)": {
          default: `${tokens.reviewPageTop} max(${space.s24}, var(--review-rail-gutter, 0px)) calc(120px + var(--review-toc-tail, 0px)) ${space.s24}`,
          [stylex.env.narrow]:
            `${space.s24} ${space.s8} calc(96px + var(--review-toc-tail, 0px))`,
        },
      },
      [stylex.env.narrow]:
        `${space.s24} ${space.s8} calc(96px + var(--review-toc-tail, 0px))`,
    },
  },
  // While the contents rail shows, the page keeps its ticks' gutter clear:
  // the wider layouts' padding already does, the compact one widens to it.
  // Blocks stay inside the page's padding, so nothing runs under the ticks.
  reviewRegionRail: {
    "--review-rail-gutter": {
      default: tocRail.gutter,
      [stylex.env.tocRailHidden]: "0px",
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
