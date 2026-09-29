import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

import { documentStyles } from "./document-styles";

/**
 * The one empty state the review panes share: a document that cannot render,
 * a software map that cannot render, and commits with no pinned source. In a
 * document it reads as the document's own heading and prose.
 */
export function ReviewUnavailable({
  title,
  message,
  role = "alert",
  action,
}: {
  title?: string;
  message: ReactNode;
  role?: "alert" | "status";
  action?: ReactNode;
}): ReactElement {
  return (
    <div role={role}>
      {title ? <h2 {...stylex.props(documentStyles.h2)}>{title}</h2> : null}
      <p {...stylex.props(documentStyles.note)}>{message}</p>
      {action}
    </div>
  );
}
