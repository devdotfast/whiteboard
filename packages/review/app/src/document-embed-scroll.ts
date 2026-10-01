import { type RefObject, useEffect } from "react";

/** Ordinary vertical wheel gestures belong to the document, even when an
 * embedded native editor handles wheel input. Other gestures stay with embeds,
 * as do all gestures over a code peek the reader has clicked into. */
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
  const onWheel = (event: WheelEvent) => {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.deltaY === 0 ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
      !(event.target instanceof Element)
    )
      return;

    const embed = event.target.closest(
      ".sequence-diagram, .flow-diagram, .database-lens, .code-peek",
    );

    if (
      !embed?.closest(".review-document") ||
      !region.contains(embed) ||
      embed.matches(".code-peek:focus-within")
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

  region.addEventListener("wheel", onWheel, { capture: true, passive: false });

  return () => region.removeEventListener("wheel", onWheel, { capture: true });
}
