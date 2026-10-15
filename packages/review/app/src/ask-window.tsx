import { space } from "@canvas/scale.stylex";
import { AgentLogo } from "@canvas/ui/brand-icons";
import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import {
  ChatIcon,
  CloseIcon,
  DockIcon,
  GripIcon,
  MinusIcon,
} from "@canvas/ui/icons";
import { useTooltip } from "@canvas/ui/tooltip";
import * as stylex from "@stylexjs/stylex";
import {
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useReviewDebugSettings } from "./debug-settings";
import { appMarker } from "./markers.stylex";
import { useReviewPanel, useReviewPanelStore } from "./review-panel";
import type { AskAnchor, AskSize } from "./review-panel-model";
import { useReviewContainer } from "./review-root-context";
import { panelStyles } from "./side-panel-styles";
import { withClass } from "./stylex-props";
import { themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";
import { IconButton } from "./ui/button";
import { surfaceStyles } from "./ui/surface";
import { textStyles } from "./ui/text";

// Clear of the canvas's edges and of what is docked beside it.
const GAP = 24;

// As wide as the docked panel opens.
const WINDOW_WIDTH = 560;

const WINDOW_HEIGHT = 600;

const MIN_WIDTH = 360;

const MIN_HEIGHT = 320;

// Bottom right, beside any docked panel.
const DEFAULT_ANCHOR: AskAnchor = {
  x: "right",
  y: "bottom",
  dx: GAP,
  dy: GAP,
};

// Every edge and corner of the window resizes it.
const RESIZE_EDGES = ["n", "e", "s", "w", "ne", "se", "sw", "nw"] as const;

type ResizeEdges = (typeof RESIZE_EDGES)[number];

type Scrolled = { element: HTMLElement; top: number; atEnd: boolean };

// Where each conversation was scrolled when it last left a slot. A
// detached element forgets its scrolling, and the slot it moves into mounts
// only after the one it left has let go, so it is read before leaving.
const scrolledOnLeave = new WeakMap<HTMLElement, Scrolled[]>();

function scrolledWithin(node: HTMLElement): Scrolled[] {
  return [...node.querySelectorAll<HTMLElement>("*")].flatMap((element) =>
    element.scrollTop > 0
      ? [
          {
            element,
            top: element.scrollTop,
            atEnd:
              element.scrollHeight - element.scrollTop - element.clientHeight <=
              2,
          },
        ]
      : [],
  );
}

/**
 * Where Ask's conversation is attached right now. The conversation renders
 * once, into `node`, and moves between the side panel and the window, so
 * switching never restarts it. Moving an element resets its scrolling, so
 * the slot carries that across, including through a minimize: a thread at
 * its latest stays there, and one read partway back reopens where it was.
 */
export function AskSlot({ node }: { node: HTMLElement }): ReactElement {
  const slot = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const parent = slot.current;

    if (!parent) return;
    node.className = stylex.props(styles.fill).className ?? "";

    parent.append(node);

    for (const { element, top, atEnd } of scrolledOnLeave.get(node) ?? [])
      element.scrollTop = atEnd ? element.scrollHeight : top;

    return () => {
      if (node.parentNode !== parent) return;
      scrolledOnLeave.set(node, scrolledWithin(node));
      node.remove();
    };
  }, [node]);

  return <div ref={slot} {...stylex.props(styles.fill)} />;
}

/** An Ask in the window over the canvas, above peeks and fullscreen
 * diagrams. */
export function AskWindow({
  askKey,
  actions,
  titleAccessory,
  onHide,
  onClose,
  closeRef,
  children,
}: {
  askKey: number;
  /** The conversation's own buttons, before dock, hide and close. */
  actions: ReactNode;
  titleAccessory?: ReactNode;
  /** Hides the window; the agent runs on, and Threads lists it. */
  onHide: () => void;
  onClose: () => void;
  closeRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}): ReactElement {
  const store = useReviewPanelStore();
  const anchor = useReviewPanel((state) => state.askAnchor) ?? DEFAULT_ANCHOR;
  const size = useReviewPanel((state) => state.askSize);
  const canvas = useAskCanvas();
  const dockTooltip = useTooltip("Dock in the side panel");
  const hideTooltip = useTooltip("Hide · keeps running");

  const [live, setLive] = useState<{
    frame: Frame;
    edges: ResizeEdges | null;
  } | null>(null);

  const gesture = useRef<{
    edges: ResizeEdges | null;
    x: number;
    y: number;
    from: Frame;
  } | null>(null);

  const { minWidth, minHeight } = windowLimits(canvas);
  const frame = live?.frame ?? windowFrame(anchor, size, canvas);

  const start = (
    event: PointerEvent<HTMLElement>,
    edges: ResizeEdges | null,
  ) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button"))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      edges,
      x: event.clientX,
      y: event.clientY,
      from: frame,
    };
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current;

    if (!current) return;
    const { edges, from } = current;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;

    if (!edges) {
      setLive({
        frame: {
          ...from,
          left: clamp(from.left + dx, GAP, canvas.width - from.width - GAP),
          top: clamp(from.top + dy, GAP, canvas.height - from.height - GAP),
        },
        edges,
      });

      return;
    }

    // An edge moves alone; the opposite one stays put.
    const right = from.left + from.width;
    const bottom = from.top + from.height;
    let { left, top, width, height } = from;

    if (edges.includes("w")) {
      left = clamp(from.left + dx, GAP, right - minWidth);
      width = right - left;
    } else if (edges.includes("e"))
      width = clamp(from.width + dx, minWidth, canvas.width - GAP - left);

    if (edges.includes("n")) {
      top = clamp(from.top + dy, GAP, bottom - minHeight);
      height = bottom - top;
    } else if (edges.includes("s"))
      height = clamp(from.height + dy, minHeight, canvas.height - GAP - top);

    setLive({ frame: { left, top, width, height }, edges });
  };

  const end = () => {
    if (!gesture.current) return;
    gesture.current = null;

    if (live)
      store
        .getState()
        .placeAsk(
          anchorOf(live.frame, canvas),
          live.edges
            ? { width: live.frame.width, height: live.frame.height }
            : undefined,
        );
    setLive(null);
  };

  const gestureHandlers = {
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
  };

  return (
    <AskLayer>
      <div
        {...stylex.props(surfaceStyles.dialog, panelStyles.tray, styles.window)}
        role="dialog"
        aria-label="Ask"
        style={{
          ...frame,
          visibility: canvas.measured ? undefined : "hidden",
        }}
      >
        <div
          {...stylex.props(
            panelStyles.header,
            panelStyles.tray,
            styles.titleBar,
            live && !live.edges && styles.dragging,
          )}
          onPointerDown={(event) => start(event, null)}
          {...gestureHandlers}
        >
          <div {...stylex.props(styles.title)}>
            <GripIcon xstyle={styles.grip} />
            <span
              {...stylex.props(
                textStyles.eyebrow,
                panelStyles.kicker,
                panelStyles.trayKicker,
              )}
            >
              Ask
            </span>
            {titleAccessory}
          </div>
          <div {...stylex.props(panelStyles.actions)}>
            {actions}
            <IconButton
              ref={dockTooltip}
              size="large"
              aria-label="Dock Ask in the side panel"
              onClick={() => store.getState().dockAsk(askKey)}
            >
              <DockIcon xstyle={[iconStyles.inert, iconStyles.chrome]} />
            </IconButton>
            <IconButton
              ref={hideTooltip}
              size="large"
              aria-label="Hide Ask"
              onClick={onHide}
            >
              <MinusIcon xstyle={[iconStyles.inert, iconStyles.chrome]} />
            </IconButton>
            <IconButton
              ref={closeRef}
              size="large"
              aria-label="Close Ask"
              onClick={onClose}
            >
              <CloseIcon xstyle={iconStyles.inert} />
            </IconButton>
          </div>
        </div>
        <div {...stylex.props(styles.body)}>{children}</div>
        {RESIZE_EDGES.map((edges) => (
          <div
            key={edges}
            aria-hidden="true"
            {...stylex.props(styles.edge, edgeStyles[edges])}
            onPointerDown={(event) => start(event, edges)}
            {...gestureHandlers}
          />
        ))}
      </div>
    </AskLayer>
  );
}

/** A box on the canvas, from its top left. */
interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The window's smallest size: never smaller than the canvas allows. */
function windowLimits(canvas: AskCanvas) {
  return {
    minWidth: Math.min(MIN_WIDTH, canvas.width - GAP * 2),
    minHeight: Math.min(MIN_HEIGHT, canvas.height - GAP * 2),
  };
}

/** Where the window is, at rest: its size kept inside the canvas, never
 * closer than GAP to its edges. */
function windowFrame(
  anchor: AskAnchor,
  size: AskSize | null,
  canvas: AskCanvas,
): Frame {
  const { minWidth, minHeight } = windowLimits(canvas);

  const width = clamp(
    size?.width ?? WINDOW_WIDTH,
    minWidth,
    canvas.width - GAP * 2,
  );

  const height = clamp(
    size?.height ?? WINDOW_HEIGHT,
    minHeight,
    canvas.height - GAP * 2,
  );

  return placeAt(anchor, { width, height }, canvas, GAP);
}

/** Where a window of this size goes for the anchor, kept `edge` inside
 * the canvas. */
function placeAt(
  anchor: AskAnchor,
  size: { width: number; height: number },
  canvas: AskCanvas,
  edge: number,
): Frame {
  const left =
    anchor.x === "left"
      ? anchor.dx
      : canvas.width - canvas.right - anchor.dx - size.width;

  const top =
    anchor.y === "top"
      ? anchor.dy
      : canvas.height - canvas.bottom - anchor.dy - size.height;

  return {
    left: clamp(left, edge, canvas.width - size.width - edge),
    top: clamp(top, edge, canvas.height - size.height - edge),
    ...size,
  };
}

/** The anchor for a box dropped here: its distance from the nearest corner
 * of the canvas beside any docked panel. */
function anchorOf(frame: Frame, canvas: AskCanvas): AskAnchor {
  const freeWidth = canvas.width - canvas.right;
  const freeHeight = canvas.height - canvas.bottom;
  const x = frame.left + frame.width / 2 < freeWidth / 2 ? "left" : "right";
  const y = frame.top + frame.height / 2 < freeHeight / 2 ? "top" : "bottom";

  return {
    x,
    y,
    dx: x === "left" ? frame.left : freeWidth - frame.left - frame.width,
    dy: y === "top" ? frame.top : freeHeight - frame.top - frame.height,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/** Above the canvas and its fullscreen diagrams, which portal to the canvas
 * root outside the app: the theme comes along, as it does for them. */
function AskLayer({ children }: { children: ReactNode }): ReactElement {
  const container = useReviewContainer();
  const { theme } = useReviewDebugSettings();

  return createPortal(
    <div
      {...withClass(
        `review-app--theme-${theme}`,
        appMarker,
        themeStyles.vars,
        theme === "light" && themeStyles.light,
        styles.layer,
      )}
    >
      {children}
    </div>,
    container ?? document.body,
  );
}

interface AskCanvas {
  /** Where the canvas is in the viewport. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** How much of the canvas's right and bottom edges a docked panel takes. */
  right: number;
  bottom: number;
  /** False until the panels beside Ask have been measured. */
  measured: boolean;
}

/**
 * The canvas Ask floats over, and how much of its right and bottom edges is
 * taken: by the side panel or a fullscreen diagram's tour docked on the
 * right, or by the side panel as a bottom sheet on a narrow canvas. Both are
 * side panels. The canvas root contains its layout, so the window is fixed
 * to it, not to the viewport.
 */
function useAskCanvas(): AskCanvas {
  const store = useReviewPanelStore();
  const container = useReviewContainer();

  const [canvas, setCanvas] = useState<AskCanvas>(() => ({
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
    right: 0,
    bottom: 0,
    measured: false,
  }));

  // Measured before the first paint, so the window never shows where an
  // unmeasured canvas would put it.
  useLayoutEffect(() => {
    const root = container ?? document.documentElement;
    let frame = 0;
    const observer = new ResizeObserver(() => schedule());

    const measure = () => {
      const bounds = root.getBoundingClientRect();
      let right = 0;
      let bottom = 0;

      observer.disconnect();
      observer.observe(root);

      for (const panel of root.querySelectorAll<HTMLElement>(
        "aside.side-panel",
      )) {
        observer.observe(panel);
        const rect = panel.getBoundingClientRect();

        if (!rect.width || !rect.height) continue;

        if (
          rect.right >= bounds.right - 1 &&
          rect.left > bounds.left + bounds.width * 0.3
        )
          right = Math.max(right, bounds.right - rect.left);
        else if (
          rect.bottom >= bounds.bottom - 1 &&
          rect.top > bounds.top + bounds.height * 0.3
        )
          bottom = Math.max(bottom, bounds.bottom - rect.top);
      }

      const next = {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        right,
        bottom,
        measured: true,
      };

      setCanvas((current) =>
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.height === next.height &&
        current.right === next.right &&
        current.bottom === next.bottom &&
        current.measured
          ? current
          : next,
      );
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    const unsubscribe = store.subscribe(schedule);

    window.addEventListener("resize", schedule);
    // A panel slides in: measure where it lands.
    document.addEventListener("animationend", schedule, true);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("animationend", schedule, true);
    };
  }, [container, store]);

  return canvas;
}

const styles = stylex.create({
  // One above the fullscreen diagrams.
  layer: {
    position: "fixed",
    zIndex: `calc(${tokens.reviewDebugLayer} + 1)`,
  },
  fill: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  },
  window: {
    position: "fixed",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  titleBar: {
    paddingLeft: space.s10,
    cursor: "grab",
    touchAction: "none",
    userSelect: "none",
  },
  dragging: {
    cursor: "grabbing",
  },
  // Shows only as the cursor, over the window's edge.
  edge: {
    position: "absolute",
    zIndex: 1,
    touchAction: "none",
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    minWidth: 0,
  },
  grip: {
    color: tokens.inkFaint,
  },
  body: {
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
  },
});

const EDGE = "6px";

const CORNER = "12px";

const edgeStyles = stylex.create({
  n: { top: 0, left: CORNER, right: CORNER, height: EDGE, cursor: "ns-resize" },
  s: {
    bottom: 0,
    left: CORNER,
    right: CORNER,
    height: EDGE,
    cursor: "ns-resize",
  },
  e: {
    top: CORNER,
    bottom: CORNER,
    right: 0,
    width: EDGE,
    cursor: "ew-resize",
  },
  w: { top: CORNER, bottom: CORNER, left: 0, width: EDGE, cursor: "ew-resize" },
  ne: {
    top: 0,
    right: 0,
    width: CORNER,
    height: CORNER,
    cursor: "nesw-resize",
  },
  sw: {
    bottom: 0,
    left: 0,
    width: CORNER,
    height: CORNER,
    cursor: "nesw-resize",
  },
  nw: { top: 0, left: 0, width: CORNER, height: CORNER, cursor: "nwse-resize" },
  se: {
    bottom: 0,
    right: 0,
    width: CORNER,
    height: CORNER,
    cursor: "nwse-resize",
  },
});
