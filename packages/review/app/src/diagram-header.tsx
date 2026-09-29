import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { diagramStyles } from "./diagram-styles";

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
    <figcaption {...stylex.props(diagramStyles.header, xstyle)}>
      <div {...stylex.props(diagramStyles.headerMain)}>
        <span {...stylex.props(diagramStyles.kindBadge)}>{kind}</span>
        {title && (
          <span {...stylex.props(diagramStyles.title)} data-review-copy-prose>
            {title}
          </span>
        )}
        {meta && (
          <em {...stylex.props(diagramStyles.meta, metaStyle)}>{meta}</em>
        )}
      </div>
      {action}
    </figcaption>
  );
}
