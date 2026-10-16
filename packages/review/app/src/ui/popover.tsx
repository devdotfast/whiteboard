import { type StyleArg } from "@canvas/stylex-props";
import * as stylex from "@stylexjs/stylex";
import {
  type ComponentProps,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { surfaceStyles } from "./surface";

type Region = RefObject<HTMLElement | null>;

/** Calls `dismiss` on Escape, on a pointer down outside every region, even
 * one whose target stops propagation, and when the window loses focus, as a
 * click into another frame or webview does. A nested control that stops its
 * Escape keeps it open. */
export function useDismissOnOutside(
  inside: Region | readonly Region[],
  open: boolean,
  dismiss: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const regions = [inside].flat();

    const outside = (event: PointerEvent) => {
      const path = event.composedPath();

      if (regions.some(({ current }) => current && path.includes(current)))
        return;
      dismiss();
    };

    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", dismiss);

    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", dismiss);
    };
  }, [inside, open, dismiss]);
}

type PopoverProps = Omit<
  ComponentProps<"div">,
  "className" | "style" | "ref" | "popover"
> & {
  /** What it hangs from; a press inside it does not dismiss. */
  anchor: Region;
  /** Escape, a press outside or the window losing focus. Without it, it stays until unmounted. */
  onDismiss?: () => void;
  ref?: RefObject<HTMLDivElement | null>;
  /** Placement and size, e.g. menuStyles.popover or
   * shellStyles.topbarPopover. */
  xstyle?: StyleArg;
};

/** A raised box in the top layer, anchored to `anchor`, so no clipping
 * ancestor cuts it off. Mount it while open. Focus inside it goes back to
 * the anchor when it closes. */
export function Popover({
  anchor,
  onDismiss,
  ref,
  xstyle,
  onKeyDown,
  ...props
}: PopoverProps) {
  const own = useRef<HTMLDivElement>(null);
  const element = ref ?? own;
  const name = `--popover-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const inside = useMemo(() => [anchor, element], [anchor, element]);

  useDismissOnOutside(inside, Boolean(onDismiss), () => onDismiss?.());

  useLayoutEffect(() => {
    const popover = element.current;
    const target = anchor.current;
    const opener = document.activeElement;

    if (!popover || !target) return;
    target.style.setProperty("anchor-name", name);
    popover.style.setProperty("position-anchor", name);
    popover.showPopover?.();

    return () => {
      if (popover.contains(document.activeElement))
        (opener instanceof HTMLElement && target.contains(opener)
          ? opener
          : target
        ).focus();
      popover.hidePopover?.();
      target.style.removeProperty("anchor-name");
    };
  }, [anchor, element, name]);

  return (
    <div
      ref={element}
      popover="manual"
      {...props}
      {...stylex.props(surfaceStyles.popover, xstyle)}
      onKeyDown={(event) => {
        onKeyDown?.(event);

        if (!onDismiss || event.key !== "Escape") return;
        // Escape closes this, not what is behind it.
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
    />
  );
}
