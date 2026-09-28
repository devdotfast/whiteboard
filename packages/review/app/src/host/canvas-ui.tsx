import type {
  ReviewCanvasUi,
  ReviewMenuRequest,
} from "@dev.fast/review-protocol";
import { createContext, useContext, useEffect, useRef, useState } from "react";

export const CanvasUiContext = createContext<ReviewCanvasUi | undefined>(
  undefined,
);

export function useCanvasMenu() {
  const ui = useContext(CanvasUiContext);
  const [open, setOpen] = useState(false);
  const menu = useRef<{ dispose(): void } | undefined>(undefined);

  useEffect(() => () => menu.current?.dispose(), [ui]);

  return {
    available: Boolean(ui),
    open,
    show(request: Omit<ReviewMenuRequest, "onHide">) {
      if (!ui) return;
      menu.current?.dispose();
      setOpen(true);
      menu.current = ui.showMenu({ ...request, onHide: () => setOpen(false) });
    },
  };
}
