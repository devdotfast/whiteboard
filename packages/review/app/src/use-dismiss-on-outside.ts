import { type RefObject, useEffect } from "react";

/** Closes a menu on a pointer down outside `container`, on Esc, and when
 * the window loses focus, as a click into another frame or webview does,
 * which this document never sees. */
export function useDismissOnOutside(
  container: RefObject<HTMLElement | null>,
  open: boolean,
  dismiss: (open: false) => void,
  pointerCapture = false,
  keyCapture = false,
) {
  useEffect(() => {
    if (!open) return;

    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        container.current?.contains(event.target)
      )
        return;
      dismiss(false);
    };

    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss(false);
    };

    const blur = () => dismiss(false);

    document.addEventListener("pointerdown", outside, pointerCapture);
    document.addEventListener("keydown", escape, keyCapture);
    window.addEventListener("blur", blur);

    return () => {
      document.removeEventListener("pointerdown", outside, pointerCapture);
      document.removeEventListener("keydown", escape, keyCapture);
      window.removeEventListener("blur", blur);
    };
  }, [container, open, dismiss, pointerCapture, keyCapture]);
}
