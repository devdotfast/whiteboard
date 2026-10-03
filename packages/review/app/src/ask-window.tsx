import * as stylex from "@stylexjs/stylex";
import {
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { logos } from "./ask-agent-picker";
import { controlStyles } from "./controls-styles";
import { useReviewDebugSettings } from "./debug-settings";
import { ChatIcon, CloseIcon, DockIcon, GripIcon, MinusIcon } from "./icons";
import { appMarker } from "./markers.stylex";
import { useReviewPanel, useReviewPanelStore } from "./review-panel";
import type { AskAnchor, AskPresence } from "./review-panel-model";
import { useReviewContainer } from "./review-root-context";
import { elevation, fontSize, radius } from "./scale.stylex";
import { panelStyles } from "./side-panel-styles";
import { withClass } from "./stylex-props";
import { themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";
import { IconButton } from "./ui/button";
import { Chip } from "./ui/chip";
import { surfaceStyles } from "./ui/surface";
import { textStyles } from "./ui/text";
import { useTooltip } from "./use-tooltip";

export type { AskPresence };

// Clear of the canvas's edges and of what is docked beside the pill.
const GAP = 24;

// As wide as the docked panel opens.
const WINDOW_WIDTH = 560;

const WINDOW_HEIGHT = 600;

const MIN_WIDTH = 360;

const MIN_HEIGHT = 320;

// How close to the canvas's edges a dragged pill may go.
const PILL_EDGE = 8;

// A press on the pill that moves less than this is a click.
const DRAG_THRESHOLD = 4;

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

/**
 * Where Ask's conversation is attached right now. The conversation renders
 * once, into `node`, and moves between the side panel and the window, so
 * switching never restarts it. Moving an element resets its scrolling, so
 * the slot carries that across: a thread at its latest stays there.
 */
export function AskSlot({ node }: { node: HTMLElement }): ReactElement {
  const slot = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const parent = slot.current;

    if (!parent) return;
    node.className = stylex.props(styles.fill).className ?? "";

    const scrolled = [...node.querySelectorAll<HTMLElement>("*")].flatMap(
      (element) =>
        element.scrollTop > 0
          ? [
              {
                element,
                top: element.scrollTop,
                atEnd:
                  element.scrollHeight -
                    element.scrollTop -
                    element.clientHeight <=
                  2,
              },
            ]
          : [],
    );

    parent.append(node);

    for (const { element, top, atEnd } of scrolled)
      element.scrollTop = atEnd ? element.scrollHeight : top;

    return () => {
      if (node.parentNode === parent) node.remove();
    };
  }, [node]);

  return <div ref={slot} {...stylex.props(styles.fill)} />;
}

/** Ask in a window over the canvas, above peeks and fullscreen diagrams. */
export function AskWindow({
  actions,
  titleAccessory,
  onClose,
  children,
}: {
  /** The conversation's own buttons, before dock, minimize and close. */
  actions: ReactNode;
  titleAccessory?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}): ReactElement {
  const store = useReviewPanelStore();
  const anchor = useReviewPanel((state) => state.askAnchor) ?? DEFAULT_ANCHOR;
  const size = useReviewPanel((state) => state.askSize);
  const canvas = useAskCanvas();
  const dockTooltip = useTooltip("Dock in the side panel");
  const minimizeTooltip = useTooltip("Minimize");

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

  // Never smaller than the canvas allows, nor closer than GAP to its edges.
  const maxWidth = canvas.width - GAP * 2;
  const maxHeight = canvas.height - GAP * 2;
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const minHeight = Math.min(MIN_HEIGHT, maxHeight);
  const width = clamp(size?.width ?? WINDOW_WIDTH, minWidth, maxWidth);
  const height = clamp(size?.height ?? WINDOW_HEIGHT, minHeight, maxHeight);

  const frame = live?.frame ?? placeAt(anchor, { width, height }, canvas, GAP);

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
              onClick={() => store.getState().dockAsk()}
            >
              <DockIcon
                xstyle={[controlStyles.inertIcon, controlStyles.chromeIcon]}
              />
            </IconButton>
            <IconButton
              ref={minimizeTooltip}
              size="large"
              aria-label="Minimize Ask"
              onClick={() => store.getState().minimizeAsk()}
            >
              <MinusIcon
                xstyle={[controlStyles.inertIcon, controlStyles.chromeIcon]}
              />
            </IconButton>
            <IconButton size="large" aria-label="Close Ask" onClick={onClose}>
              <CloseIcon xstyle={controlStyles.inertIcon} />
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

/** Ask, minimized or covered: who is answering and how it is going, in the
 * window's corner. Drag it anywhere; a press that barely moves opens Ask. */
export function AskPill({ presence }: { presence: AskPresence }): ReactElement {
  const store = useReviewPanelStore();
  const anchor = useReviewPanel((state) => state.askAnchor) ?? DEFAULT_ANCHOR;
  const canvas = useAskCanvas();
  const pill = useRef<HTMLButtonElement>(null);
  const [live, setLive] = useState<Frame | null>(null);

  const press = useRef<{
    x: number;
    y: number;
    from: Frame;
    moved: boolean;
  } | null>(null);

  // The click that ends a drag drops the pill; it does not open Ask.
  const dropped = useRef(false);

  const waiting = presence.tone === "waiting";
  const measured = useElementSize(pill);

  const frame =
    live ?? (measured ? placeAt(anchor, measured, canvas, PILL_EDGE) : null);

  const startPress = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();

    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = {
      x: event.clientX,
      y: event.clientY,
      from: {
        left: rect.left - canvas.left,
        top: rect.top - canvas.top,
        width: rect.width,
        height: rect.height,
      },
      moved: false,
    };
  };

  const movePress = (event: PointerEvent<HTMLButtonElement>) => {
    const current = press.current;

    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;

    if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    const { from } = current;

    current.moved = true;
    setLive({
      ...from,
      left: clamp(
        from.left + dx,
        PILL_EDGE,
        canvas.width - from.width - PILL_EDGE,
      ),
      top: clamp(
        from.top + dy,
        PILL_EDGE,
        canvas.height - from.height - PILL_EDGE,
      ),
    });
  };

  const endPress = () => {
    const current = press.current;

    press.current = null;

    if (!current?.moved || !live) return;
    dropped.current = true;
    store.getState().placeAsk(anchorOf(live, canvas));
    setLive(null);
  };

  return (
    <AskLayer>
      <button
        ref={pill}
        type="button"
        {...stylex.props(
          surfaceStyles.popover,
          styles.pill,
          waiting && styles.pillWaiting,
          live && styles.pillLifted,
        )}
        style={
          frame && canvas.measured
            ? { left: frame.left, top: frame.top }
            : { visibility: "hidden" }
        }
        aria-label={`Open Ask: ${presence.agentName}, ${presence.status}`}
        onPointerDown={startPress}
        onPointerMove={movePress}
        onPointerUp={endPress}
        onPointerCancel={() => {
          press.current = null;
          setLive(null);
        }}
        onClick={() => {
          if (dropped.current) {
            dropped.current = false;

            return;
          }

          store.getState().restoreAsk();
        }}
      >
        {presence.agent ? (
          logos[presence.agent]({ xstyle: styles.logo })
        ) : (
          <ChatIcon xstyle={[styles.logo, styles.askGlyph]} />
        )}
        <span {...stylex.props(styles.name)}>{presence.agentName}</span>
        <span
          {...stylex.props(
            styles.status,
            waiting && styles.statusWaiting,
            presence.tone === "failed" && styles.statusFailed,
          )}
        >
          {presence.status}
        </span>
        <Chip
          variant="pill"
          size="large"
          xstyle={[styles.open, waiting && styles.openWaiting]}
        >
          {waiting ? "Review" : "Open"}
        </Chip>
      </button>
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

/** Where a window or pill of this size goes for the anchor, kept `edge`
 * inside the canvas. */
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

/** An element's size, once laid out and as it changes. */
function useElementSize(
  element: RefObject<HTMLElement | null>,
): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const node = element.current;

    if (!node) return;

    const measure = () =>
      setSize((current) =>
        current?.width === node.offsetWidth &&
        current.height === node.offsetHeight
          ? current
          : { width: node.offsetWidth, height: node.offsetHeight },
      );

    measure();
    const observer = new ResizeObserver(measure);

    observer.observe(node);

    return () => observer.disconnect();
  }, [element]);

  return size;
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
 * side panels. The canvas root contains its layout, so the window and the
 * pill are fixed to it, not to the viewport.
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

  // Measured before the first paint, so a window or pill never shows where an
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
    paddingLeft: "10px",
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
    gap: "8px",
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
  pill: {
    position: "fixed",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    maxWidth: `calc(100% - ${GAP * 2}px)`,
    padding: "6px 6px 6px 12px",
    borderRadius: radius.pill,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    touchAction: "none",
    userSelect: "none",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
  // While it is dragged, it lifts to the window's shadow.
  pillLifted: {
    boxShadow: elevation.dialog,
    cursor: "grabbing",
  },
  pillWaiting: {
    borderColor: tokens.changeModified,
    boxShadow: `${elevation.popover}, 0 0 0 4px ${tokens.warningWash}`,
  },
  logo: {
    width: "14px",
    height: "14px",
  },
  askGlyph: {
    color: tokens.inkMuted,
  },
  name: {
    flex: "0 0 auto",
    color: tokens.ink,
    fontSize: fontSize.body,
    lineHeight: "16px",
    whiteSpace: "nowrap",
  },
  status: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.inkMuted,
    fontSize: fontSize.body,
    lineHeight: "16px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  statusWaiting: {
    color: tokens.changeModified,
  },
  statusFailed: {
    color: tokens.changeRemoved,
  },
  open: {
    color: tokens.ink,
  },
  openWaiting: {
    backgroundColor: tokens.changeModified,
    color: tokens.onWarning,
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
