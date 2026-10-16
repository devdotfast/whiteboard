import { type StyleArg } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import {
  type ComponentProps,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from "react";

import { surfaceStyles } from "./surface";

type DialogProps = Omit<
  ComponentProps<"dialog">,
  "className" | "style" | "ref" | "open" | "onClose"
> & {
  "aria-labelledby": string;
  /** Escape, or a press outside with closedby="any". Unmount it in reply. */
  onClose(): void;
  xstyle?: StyleArg;
};

/** A modal in the top layer, shown while mounted. The page behind it is
 * inert; focus goes back to the opener when it closes. Rich content and
 * forms only: confirmations use the host's dialogs. */
export function Dialog({ onClose, xstyle, ...props }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useEffectEvent(onClose);

  useLayoutEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;

    if (!element) return;
    const closed = () => close();

    element.showModal();
    element.addEventListener("close", closed);

    return () => {
      // Unmounted while open: close first, or the opener is still inert.
      element.removeEventListener("close", closed);
      element.close();
      const focused = document.activeElement;

      if (
        opener instanceof HTMLElement &&
        (focused === document.body || element.contains(focused))
      )
        opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      {...props}
      {...stylex.props(surfaceStyles.dialog, styles.dialog, xstyle)}
    />
  );
}

const styles = stylex.create({
  dialog: {
    maxWidth: "calc(100% - 48px)",
    maxHeight: "calc(100% - 48px)",
    padding: 0,
    "::backdrop": { backgroundColor: tokens.backdrop },
  },
});
