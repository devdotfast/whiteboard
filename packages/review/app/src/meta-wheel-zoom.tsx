import { useStoreApi } from "@xyflow/react";
import { type RefObject, useEffect, useRef } from "react";

/**
 * Cmd+wheel zooms about the pointer, as Ctrl+wheel does. React Flow reads a
 * wheel as a zoom only when it carries Ctrl, which is also how a pinch
 * arrives, so Cmd is handled here.
 */
export function MetaWheelZoom({
  frame,
  onZoom,
}: {
  frame: RefObject<HTMLDivElement | null>;
  onZoom?(): void;
}) {
  const store = useStoreApi();
  const zoomed = useRef(onZoom);
  zoomed.current = onZoom;

  useEffect(() => {
    const element = frame.current;

    if (!element) return;

    const zoom = (event: WheelEvent) => {
      if (!event.metaKey || event.ctrlKey) return;

      event.preventDefault();

      const {
        panZoom,
        transform: [x, y, from],
        width,
        height,
        translateExtent,
        minZoom,
        maxZoom,
      } = store.getState();

      const box = element.getBoundingClientRect();

      const pointer = {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      };

      const to = Math.min(
        maxZoom,
        Math.max(minZoom, from * 2 ** (-event.deltaY * 0.002)),
      );

      void panZoom?.setViewportConstrained(
        {
          x: pointer.x - ((pointer.x - x) * to) / from,
          y: pointer.y - ((pointer.y - y) * to) / from,
          zoom: to,
        },
        [
          [0, 0],
          [width, height],
        ],
        translateExtent,
      );
      zoomed.current?.();
    };

    element.addEventListener("wheel", zoom, { passive: false });

    return () => element.removeEventListener("wheel", zoom);
  }, [store, frame]);

  return null;
}
