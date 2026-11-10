/** How far a press may move and still be a click rather than a drag. */
const CLICK_SLOP = 4;

/** Whether the point is on the range's words. */
export const underRange = (range: Range, x: number, y: number) =>
  [...range.getClientRects()].some(
    (rect) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  );

/**
 * Hears a plain click in the article: never a drag, a selection, a modifier,
 * a second click, or a click on anything matching `own`. Only listened to:
 * the article's blocks may belong to an editor.
 */
export function onPlainClick(
  article: HTMLElement,
  own: string,
  clicked: (event: MouseEvent) => void,
): () => void {
  let pressed: { x: number; y: number } | null = null;

  const press = (event: PointerEvent) => {
    pressed =
      event.isPrimary && event.button === 0
        ? { x: event.clientX, y: event.clientY }
        : null;
  };

  const click = (event: MouseEvent) => {
    const from = pressed;

    pressed = null;

    if (
      !from ||
      event.button !== 0 ||
      event.detail !== 1 ||
      event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      Math.hypot(event.clientX - from.x, event.clientY - from.y) > CLICK_SLOP ||
      (event.target instanceof Element && event.target.closest(own)) ||
      article.ownerDocument.getSelection()?.isCollapsed === false
    )
      return;

    clicked(event);
  };

  article.addEventListener("pointerdown", press);
  article.addEventListener("click", click);

  return () => {
    article.removeEventListener("pointerdown", press);
    article.removeEventListener("click", click);
  };
}
