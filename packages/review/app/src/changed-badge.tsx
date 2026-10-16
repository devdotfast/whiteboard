import { StatusDot } from "@canvas/ui/status-dot";
import type { ReactElement } from "react";

/** Marks a board that changed since it was last viewed, on its icon's
 * corner. */
export function ChangedBadge(): ReactElement {
  return <StatusDot label="Changed since you last viewed it" data-changed="" />;
}
