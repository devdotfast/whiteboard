import { documentType } from "@canvas/document-type.stylex";
import { fontWeight, tracking } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ComponentProps, ReactElement } from "react";

import { ReviewDocumentMetaLine } from "./review-doc-meta";
import { tokens } from "./tokens.stylex";

export function ReviewDocumentTitle({
  children,
  ...props
}: ComponentProps<"h1">): ReactElement {
  return (
    <ReviewDocumentMetaLine>
      <h1 {...props} data-review-copy-prose {...stylex.props(styles.title)}>
        {children}
      </h1>
    </ReviewDocumentMetaLine>
  );
}

const inDocument = ":is(.review-document *)";

const styles = stylex.create({
  title: {
    width: { default: null, [inDocument]: "100%" },
    maxWidth: { default: null, [inDocument]: "1000px" },
    margin: { default: null, [inDocument]: 0 },
    color: { default: null, [inDocument]: tokens.ink },
    fontFamily: { default: null, [inDocument]: tokens.fontSerif },
    fontSize: { default: null, [inDocument]: documentType.title },
    fontWeight: { default: null, [inDocument]: fontWeight.medium },
    lineHeight: { default: null, [inDocument]: "38px" },
    letterSpacing: { default: null, [inDocument]: tracking.tight },
    textAlign: { default: null, [inDocument]: "left" },
  },
});
