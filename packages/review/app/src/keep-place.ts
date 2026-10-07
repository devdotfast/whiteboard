import { type RefObject, useEffect } from "react";

/**
 * Keeps the reader's place in `region` when it changes width, as when the
 * right column opens or closes beside the board: the text reflows, and the
 * selection, or else the line at the top, stays where it was on screen.
 */
export function useKeepPlace(region: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = region.current;

    const document_ = element?.ownerDocument;

    // jsdom has no layout to keep.
    if (
      !element ||
      !document_ ||
      !("ResizeObserver" in globalThis) ||
      !("elementFromPoint" in document_)
    )
      return;
    let anchor: { node: Element; offset: number } | null = null;
    let width = element.clientWidth;
    let frame: number | undefined;

    const top = () => element.getBoundingClientRect().top;

    // The selection's start while it is on screen, else what is at the top.
    const pick = () => {
      frame = undefined;

      // Resized and not yet put back: the place from before still holds.
      if (element.clientWidth !== width) return;
      const viewport = element.getBoundingClientRect();
      const selection = document_.getSelection();
      let node: Element | null = null;

      if (selection?.rangeCount && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const box = range.getBoundingClientRect();
        const start = range.startContainer;

        if (
          element.contains(start) &&
          box.bottom > viewport.top &&
          box.top < viewport.bottom
        )
          node = start instanceof Element ? start : start.parentElement;
      }

      if (!node) {
        const hit = document_.elementFromPoint(
          viewport.left + element.clientWidth / 2,
          viewport.top + 8,
        );

        node = hit && element.contains(hit) && hit !== element ? hit : null;
      }

      anchor = node
        ? { node, offset: node.getBoundingClientRect().top - viewport.top }
        : null;
    };

    const later = () => {
      frame ??= requestAnimationFrame(pick);
    };

    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;

      if (!anchor?.node.isConnected) return;
      element.scrollTop +=
        anchor.node.getBoundingClientRect().top - top() - anchor.offset;
    });

    pick();
    observer.observe(element);
    element.addEventListener("scroll", later, { passive: true });
    document_.addEventListener("selectionchange", later);

    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", later);
      document_.removeEventListener("selectionchange", later);

      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [region]);
}
