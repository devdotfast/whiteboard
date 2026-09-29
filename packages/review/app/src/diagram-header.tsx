import type * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { withClass } from "./stylex-props";

export function DiagramHeader({
  kind,
  title,
  meta,
  action,
  xstyle,
  metaStyle,
}: {
  kind: string;
  title?: string;
  meta?: string;
  action?: ReactNode;
  xstyle?: stylex.StaticStyles;
  metaStyle?: stylex.StaticStyles;
}) {
  return (
    <figcaption {...withClass("diagram-header", xstyle)}>
      <div className="diagram-header-main">
        <span className="diagram-kind-badge">{kind}</span>
        {title && (
          <span className="diagram-header-title" data-review-copy-prose>
            {title}
          </span>
        )}
        {meta && (
          <em {...withClass("diagram-header-meta", metaStyle)}>{meta}</em>
        )}
      </div>
      {action}
    </figcaption>
  );
}
