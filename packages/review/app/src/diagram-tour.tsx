import * as stylex from "@stylexjs/stylex";
import type {
  CSSProperties,
  HTMLAttributes,
  ReactElement,
  ReactNode,
  Ref,
} from "react";
import { useEffect, useRef } from "react";

import { useReviewDebugSettings } from "./debug-settings";
import { GuidedTourPanel } from "./review-components";
import type { GuidedTour } from "./review-panel-model";
import { useReviewContainer } from "./review-root-context";
import { shellStyles } from "./shell-styles";
import { useRightPanelResize } from "./side-panel-resizer";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";

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
  paneWidth,
  separatorProps,
  overlayRef,
  onActiveAnchorChange,
  onClose,
  children,
}: {
  /** A flow keeps its stage, stacked over the panel, when the canvas is narrow. */
  flow?: boolean;
  tour: GuidedTour;
  activeAnchor: string;
  revealRequest: number;
  paneWidth: number;
  separatorProps: HTMLAttributes<HTMLDivElement>;
  overlayRef: Ref<HTMLDivElement>;
  onActiveAnchorChange: (anchor: string, options: { reveal: boolean }) => void;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  // The overlay portals into .review-canvas-root, OUTSIDE .review-app — the
  // element the theme modifier lives on. Carrying the modifier here keeps the
  // light theme's token overrides in scope for the stage and the panel.
  const { theme } = useReviewDebugSettings();

  // SAFETY: `--diagram-tour-pane-width` is a CSS custom property, which React
  // forwards to style.setProperty; the CSSProperties typings only omit custom
  // names.
  const overlayStyle = {
    "--diagram-tour-pane-width": `${paneWidth}px`,
  } as CSSProperties;

  return (
    <div
      ref={overlayRef}
      {...withClass(
        `diagram-tour-overlay review-app--theme-${theme}`,
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
        {...stylex.props(shellStyles.resizer, styles.resizer)}
        {...separatorProps}
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
 * target, Escape-to-close, the canvas scroll lock, and the resizable pane
 * width (one persisted width across diagram kinds).
 */
export function useDiagramTourShell(open: boolean, onClose: () => void) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // The desktop build wraps every canvas rule in @scope (.review-canvas-root),
  // so the overlay must portal INSIDE the canvas root or it renders unstyled.
  const portalTarget = useReviewContainer();

  const paneResize = useRightPanelResize({
    stateKey: "diagram-tour-pane-width",
    defaultWidth: 594,
    minWidth: 360,
    maxWidth: 760,
    minMainWidth: 480,
    separatorWidth: 10,
    label: "Resize tour pane",
    containerRef: overlayRef,
  });

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);

    // Lock the canvas scroller (not document.body: the canvas composes into
    // the host DOM, so the element that actually scrolls the review is the
    // view region).
    const scroller = document.querySelector<HTMLElement>(
      ".review-view-region--review",
    );

    const originalOverflow = scroller?.style.overflow ?? "";

    if (scroller) scroller.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);

      if (scroller) scroller.style.overflow = originalOverflow;
    };
  }, [onClose, open]);

  return { overlayRef, portalTarget, paneResize };
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
