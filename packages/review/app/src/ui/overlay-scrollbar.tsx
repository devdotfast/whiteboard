import { motion, radius } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

// How long the thumb stays after the last scroll, as Code OSS's overlay
// scrollbars do.
const HIDE_AFTER_MS = 800;

const MIN_THUMB = 32;

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

/**
 * A vertical scrollbar laid over `scroller`'s right edge that takes no layout
 * width: it shows while the scroller scrolls, while the pointer is over its
 * lane, and while it is dragged, then fades. Render it as a sibling of the
 * scroller inside a positioned parent, and give the scroller
 * `overlayScrollbarStyles.scroller` to hide its native bar.
 */
export function OverlayScrollbar({
  scroller,
}: {
  scroller: HTMLElement | null;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [scrolling, setScrolling] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [scrollable, setScrollable] = useState(false);
  const drag = useRef<{ pointerY: number; scrollTop: number } | null>(null);

  useEffect(() => {
    if (!scroller) return;

    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const layout = () => {
      const lane = laneRef.current;
      const thumb = thumbRef.current;

      if (!lane || !thumb) return;
      const { scrollHeight, clientHeight, scrollTop } = scroller;
      const overflows = scrollHeight > clientHeight + 1;
      setScrollable(overflows);
      lane.style.top = `${scroller.offsetTop}px`;
      lane.style.height = `${clientHeight}px`;
      lane.style.left = `${scroller.offsetLeft + scroller.offsetWidth}px`;

      if (!overflows) return;

      const thumbHeight = Math.max(
        MIN_THUMB,
        (clientHeight * clientHeight) / scrollHeight,
      );

      const travel = clientHeight - thumbHeight;
      const offset = (scrollTop / (scrollHeight - clientHeight)) * travel;
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${offset}px)`;
    };

    const onScroll = () => {
      layout();
      setScrolling(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setScrolling(false), HIDE_AFTER_MS);
    };

    // Content grows and shrinks without scrolling (code cards load, stops
    // expand), so watch the scroller and everything directly in it.
    const resize = new ResizeObserver(layout);

    const observeChildren = () => {
      resize.disconnect();
      resize.observe(scroller);

      for (const child of scroller.children) resize.observe(child);
    };

    const children = new MutationObserver(observeChildren);
    observeChildren();
    children.observe(scroller, { childList: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    layout();

    return () => {
      clearTimeout(hideTimer);
      resize.disconnect();
      children.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [scroller]);

  const travelRatio = () => {
    const thumb = thumbRef.current;

    if (!scroller || !thumb) return 0;
    const travel = scroller.clientHeight - thumb.offsetHeight;

    return travel > 0
      ? (scroller.scrollHeight - scroller.clientHeight) / travel
      : 0;
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scroller || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerY: event.clientY, scrollTop: scroller.scrollTop };
    setDragging(true);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scroller || !drag.current) return;
    scroller.scrollTop =
      drag.current.scrollTop +
      (event.clientY - drag.current.pointerY) * travelRatio();
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  // A click in the lane pages toward it, as a native track does.
  const pageToward = (event: ReactPointerEvent<HTMLDivElement>) => {
    const thumb = thumbRef.current;

    if (!scroller || !thumb || event.button !== 0) return;
    event.preventDefault();
    const { top, bottom } = thumb.getBoundingClientRect();
    const direction = event.clientY < top ? -1 : event.clientY > bottom ? 1 : 0;
    scroller.scrollBy({ top: direction * scroller.clientHeight * 0.9 });
  };

  return (
    <div
      ref={laneRef}
      aria-hidden="true"
      {...stylex.props(
        styles.lane,
        scrollable && styles.laneScrollable,
        scrollable && (scrolling || hovered || dragging) && styles.visible,
      )}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={pageToward}
    >
      <div
        ref={thumbRef}
        {...stylex.props(styles.thumb, dragging && styles.thumbDragging)}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  );
}

export const overlayScrollbarStyles = stylex.create({
  // The native bar would take layout width; the overlay replaces it.
  scroller: {
    scrollbarWidth: "none",
  },
});

const styles = stylex.create({
  // Sits just inside the scroller's right edge, over its content.
  lane: {
    position: "absolute",
    zIndex: 3,
    width: tokens.reviewScrollbarSize,
    marginLeft: `calc(-1 * ${tokens.reviewScrollbarSize})`,
    opacity: 0,
    pointerEvents: "none",
    transitionProperty: "opacity",
    transitionDuration: {
      default: motion.slow,
      [reducedMotion]: motion.instant,
    },
    transitionTimingFunction: motion.ease,
  },
  laneScrollable: {
    pointerEvents: "auto",
  },
  visible: {
    opacity: 1,
    transitionDuration: {
      default: motion.fast,
      [reducedMotion]: motion.instant,
    },
  },
  // A 6px pill centered in the lane, as the canvas's native scrollbars are.
  thumb: {
    position: "absolute",
    top: 0,
    right: "2px",
    left: "2px",
    borderRadius: radius.pill,
    backgroundColor: {
      default: tokens.reviewScrollbarThumb,
      ":hover": tokens.reviewScrollbarThumbHover,
    },
  },
  thumbDragging: {
    backgroundColor: tokens.reviewScrollbarThumbActive,
  },
});
