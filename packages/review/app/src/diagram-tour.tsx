import * as stylex from "@stylexjs/stylex";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useEffect, useRef } from "react";

import { useReviewDebugSettings } from "./debug-settings";
import { GuidedTourPanel } from "./review-components";
import type { GuidedTour } from "./review-panel-model";
import { useReviewContainer } from "./review-root-context";
import { shellStyles } from "./shell-styles";
import { useRightPanelResize } from "./side-panel-resizer";
import { withClass } from "./stylex-props";
import { themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";
import { useCanvasScrollLock } from "./use-canvas-scroll-lock";

/**
 * Fullscreen guided tour shell shared by every diagram kind: the inline
 * figure as the stage on the left, the standard GuidedTourPanel on the
 * right, and the side-panel resizer between them. The shell owns layout
 * only — the stage is whatever the document already renders inline, and
 * the panel is the same component that hosts document tours, so scrolling
 * and selection behave identically everywhere.
 */
export function DiagramTourOverlay({
  flow = false,
  tour,
  activeAnchor,
  revealRequest,
  onActiveAnchorChange,
  onClose,
  children,
}: {
  /** A flow keeps its stage, stacked over the panel, when the canvas is narrow. */
  flow?: boolean;
  tour: GuidedTour;
  activeAnchor: string;
  revealRequest: number;
  onActiveAnchorChange: (anchor: string, options: { reveal: boolean }) => void;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  // The overlay portals into .review-canvas-root, OUTSIDE .review-app — the
  // element the theme modifier lives on. Carrying the modifier here keeps the
  // light theme's token overrides in scope for the stage and the panel.
  const { theme } = useReviewDebugSettings();
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Here, not in the diagram that opens the tour: each resize step re-renders
  // only the overlay, and the stage it was handed stays put.
  const paneResize = useRightPanelResize({
    stateKey: "diagram-tour-pane-width",
    defaultWidth: 594,
    minWidth: 360,
    maxWidth: 760,
    maxContainerFraction: 0.5,
    minMainWidth: 480,
    separatorWidth: 10,
    label: "Resize tour pane",
    containerRef: overlayRef,
  });

  // SAFETY: `--diagram-tour-pane-width` is a CSS custom property, which React
  // forwards to style.setProperty; the CSSProperties typings only omit custom
  // names.
  const overlayStyle = {
    "--diagram-tour-pane-width": `${paneResize.width}px`,
  } as CSSProperties;

  return (
    <div
      ref={overlayRef}
      {...withClass(
        `diagram-tour-overlay review-app--theme-${theme}`,
        theme === "light" && themeStyles.light,
        styles.overlay,
        flow && styles.flowOverlay,
      )}
      role="dialog"
      aria-modal="true"
      aria-label={`${tour.title ?? "Guided"} tour`}
      style={overlayStyle}
    >
      <div {...stylex.props(styles.stage, flow && styles.flowStage)}>
        {children}
      </div>
      <div
        {...stylex.props(
          shellStyles.resizer,
          shellStyles.resizerGrabPanel,
          styles.resizer,
        )}
        {...paneResize.separatorProps}
      />
      <div {...stylex.props(styles.panel)}>
        <GuidedTourPanel
          tour={tour}
          activeAnchor={activeAnchor}
          revealRequest={revealRequest}
          onActiveAnchorChange={onActiveAnchorChange}
          onClose={onClose}
          docked
        />
      </div>
    </div>
  );
}

/**
 * Chrome every fullscreen diagram tour shares: the canvas-root portal
 * target, Escape-to-close and the canvas scroll lock.
 */
export function useDiagramTourShell(open: boolean, onClose: () => void) {
  // The desktop build wraps every canvas rule in @scope (.review-canvas-root),
  // so the overlay must portal INSIDE the canvas root or it renders unstyled.
  const portalTarget = useReviewContainer();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useCanvasScrollLock(open);

  return { portalTarget };
}

// A terminal split can leave the canvas too narrow for both tour columns: the
// diagram collapses before the tour panel becomes unreadable.
const narrow = "@container review-canvas (max-width: 1080px)";

// Portals inside .review-canvas-root but outside .review-app, where
// --review-debug-layer lives, hence the literal fallback.
const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: "var(--review-debug-layer, 2147483000)",
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 10px var(--diagram-tour-pane-width, 424px)",
      [narrow]: "minmax(0, 1fr)",
    },
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: tokens.bg,
  },
  flowOverlay: {
    gridTemplateRows: {
      default: null,
      [narrow]: "minmax(180px, 40%) minmax(0, 1fr)",
    },
  },
  stage: {
    display: { default: "flex", [narrow]: "none" },
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  },
  flowStage: {
    display: "flex",
  },
  resizer: {
    display: { default: null, [narrow]: "none" },
  },
  // Positioned so the panel's floating pager centers on this column.
  panel: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  },
});
