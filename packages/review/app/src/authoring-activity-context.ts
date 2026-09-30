import type { ActivitySnapshot } from "@review/review-api/activity";
import { createContext } from "react";

export const AuthoringActivityContext = createContext<
  ActivitySnapshot | "unknown" | undefined
>(undefined);
