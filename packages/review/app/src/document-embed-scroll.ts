import { type RefObject, useEffect } from "react";

/** Quiet time that ends a wheel gesture; trackpad momentum keeps it going. */
export const WHEEL_GESTURE_REST_MS = 150;

const EMBEDS = ".sequence-diagram, .flow-diagram, .database-lens, .code-peek";

const SCROLLING_EMBEDS = ".database-lens, .code-peek";

/** A vertical wheel gesture latches to where it starts: a scrollable code
 * peek or database lens scrolls alone to the gesture's end; anywhere else the
 * document scrolls past embeds. Embeds the reader clicked into keep wheels. */
export function useDocumentEmbedScroll(
  regionRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const region = regionRef.current;

    if (!region) return;

    return routeDocumentEmbedScroll(region);
  }, [regionRef]);
}

export function routeDocumentEmbedScroll(region: HTMLElement) {
  let lastWheelAt = Number.NEGATIVE_INFINITY;
  let latched: Element | null = null;
  let cancelAfterDispatch: WheelEvent | null = null;

  const onWheel = (event: WheelEvent) => {
    const now = performance.now();
    const startsGesture = now - lastWheelAt > WHEEL_GESTURE_REST_MS;
    lastWheelAt = now;

    if (startsGesture) latched = null;

    if (
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.deltaY === 0 ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
      !(event.target instanceof Element)
    )
      return;

    const target = event.target;
    const embed = target.closest(EMBEDS);

    if (
      startsGesture &&
      embed?.matches(SCROLLING_EMBEDS) &&
      canScrollVertically(target, embed)
    )
      latched = embed;

    if (latched?.isConnected && latched.contains(target)) {
      // Code OSS editors skip cancelled wheels but don't cancel them either,
      // so cancel after dispatch to keep the document still.
      if (!nativeOverflowHasRoom(target, latched, event.deltaY))
        cancelAfterDispatch = event;

      return;
    }

    if (
      !embed?.closest(".review-document") ||
      !region.contains(embed) ||
      embed.matches(".code-peek:focus-within") ||
      embed.closest("[data-board-selected]")
    )
      return;

    // Capture vertical gestures before React Flow/Monaco or native overflow can
    // consume them. Leave horizontal and modified gestures to the embed.
    event.preventDefault();
    event.stopPropagation();
    const lineHeight = parseFloat(getComputedStyle(region).lineHeight) || 20;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? lineHeight : 1;
    region.scrollBy({
      top:
        event.deltaY *
        (event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? region.clientHeight
          : unit),
      behavior: "instant",
    });
  };

  const afterWheel = (event: WheelEvent) => {
    if (event !== cancelAfterDispatch) return;
    cancelAfterDispatch = null;
    event.preventDefault();
  };

  region.addEventListener("wheel", onWheel, { capture: true, passive: false });
  region.addEventListener("wheel", afterWheel, { passive: false });

  return () => {
    region.removeEventListener("wheel", onWheel, { capture: true });
    region.removeEventListener("wheel", afterWheel);
  };
}

/** A Code OSS editor's slider has size only when it can scroll. */
function canScrollVertically(target: Element, embed: Element): boolean {
  for (
    let element: Element | null = target;
    element && embed.contains(element);
    element = element.parentElement
  ) {
    if (element.matches(".monaco-scrollable-element")) {
      const slider = element.querySelector(
        ":scope > .scrollbar.vertical > .slider",
      );

      if (slider instanceof HTMLElement && slider.offsetHeight > 0) return true;
    } else if (isNativeOverflow(element)) return true;
  }

  return false;
}

function nativeOverflowHasRoom(
  target: Element,
  embed: Element,
  deltaY: number,
): boolean {
  for (
    let element: Element | null = target;
    element && embed.contains(element);
    element = element.parentElement
  ) {
    if (element.matches(".monaco-scrollable-element")) return false;

    if (isNativeOverflow(element)) {
      const room =
        deltaY < 0
          ? element.scrollTop > 0
          : element.scrollTop + element.clientHeight < element.scrollHeight - 1;

      if (room) return true;
    }
  }

  return false;
}

function isNativeOverflow(element: Element): boolean {
  const { overflowY } = getComputedStyle(element);

  return (
    (overflowY === "auto" || overflowY === "scroll") &&
    element.scrollHeight > element.clientHeight
  );
}
