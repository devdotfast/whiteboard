import type { ActivitySnapshot } from "@dev.fast/whiteboard-document";
import { createContext } from "react";

export const AuthoringActivityContext = createContext<
  ActivitySnapshot | "unknown" | undefined
>(undefined);
