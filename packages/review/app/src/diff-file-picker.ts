import type { ReviewDiffFileWire } from "@dev.fast/review-protocol";
import { type RefObject, createContext, useContext, useEffect } from "react";

export interface DiffFilePicker {
  files(): Promise<readonly ReviewDiffFileWire[]>;
  reveal(path: string): void;
}

export const DiffFilePickerContext =
  createContext<RefObject<DiffFilePicker | null> | null>(null);

export function useDiffFilePicker(picker: DiffFilePicker): void {
  const slot = useContext(DiffFilePickerContext);

  useEffect(() => {
    if (!slot) return;
    slot.current = picker;

    return () => {
      if (slot.current === picker) slot.current = null;
    };
  }, [slot, picker]);
}
