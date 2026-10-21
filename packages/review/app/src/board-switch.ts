import { createContext, useContext, useLayoutEffect } from "react";

/** The board a switch is loading, while the last one stays on screen. */
export const BoardSwitchContext = createContext<string | undefined>(undefined);

/** A board loading unseen counts what is still drawing; it shows once
 * nothing is. */
export const DrawingContext = createContext<{
  /** Returns the call that ends it. */
  begin(): () => void;
} | null>(null);

/** Keeps a board loading unseen from showing while `drawing`. */
export function useHoldsSwap(drawing: boolean): void {
  const counter = useContext(DrawingContext);

  useLayoutEffect(() => {
    if (counter && drawing) return counter.begin();
  }, [counter, drawing]);
}
