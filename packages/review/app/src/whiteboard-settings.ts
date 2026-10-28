import type { ReviewCanvasSettings } from "@dev.fast/review-protocol";
import { createContext, useContext } from "react";

export const BoardSettings = createContext<ReviewCanvasSettings>({});

export function useWhiteboardSettings() {
  return useContext(BoardSettings);
}
