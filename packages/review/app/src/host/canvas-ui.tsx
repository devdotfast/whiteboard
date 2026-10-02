import type {
  ReviewCanvasUi,
  ReviewMenuRequest,
} from "@dev.fast/review-protocol";
import {
  type KeyboardEvent,
  type MouseEvent,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export const CanvasUiContext = createContext<ReviewCanvasUi | undefined>(
  undefined,
);

export function useCanvasMenu(
  request: Omit<ReviewMenuRequest, "anchor" | "onHide">,
) {
  const ui = useContext(CanvasUiContext);
  const [open, setOpen] = useState(false);
  const menu = useRef<{ dispose(): void } | undefined>(undefined);

  useEffect(() => () => menu.current?.dispose(), [ui]);

  const show = (anchor: HTMLButtonElement) => {
    if (!ui || open) return;
    menu.current?.dispose();
    setOpen(true);
    menu.current = ui.showMenu({
      ...request,
      anchor,
      onHide: () => setOpen(false),
    });
  };

  return {
    open,
    triggerProps: {
      disabled: !ui,
      "aria-haspopup": "menu" as const,
      "aria-expanded": open,
      onClick: (event: MouseEvent<HTMLButtonElement>) =>
        show(event.currentTarget),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          show(event.currentTarget);
        }
      },
    },
  };
}
