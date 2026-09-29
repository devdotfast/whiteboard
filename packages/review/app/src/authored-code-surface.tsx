import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

import type { PeekAnchor } from "./review-panel-model";
import { tokens } from "./tokens.stylex";

/**
 * Authored inline code shown in a side peek or tour stop. Lines are numbered
 * from the anchor's authored range when it has one, otherwise from 1.
 */
export function AuthoredCodeSurface({
  anchor,
  code,
  language,
}: {
  anchor: PeekAnchor;
  code: string;
  language?: string;
}): ReactElement {
  const firstLine = anchor.peek?.start.line ?? 1;

  return (
    <div {...stylex.props(styles.block)}>
      <pre {...stylex.props(styles.surface)} data-language={language}>
        {code
          .replace(/\r\n?/g, "\n")
          .split("\n")
          .map((text, index) => (
            <span
              {...stylex.props(styles.line)}
              key={`line:${firstLine + index}`}
            >
              <span {...stylex.props(styles.gutter)}>{firstLine + index}</span>
              <span {...stylex.props(styles.marker)} aria-hidden="true">
                {" "}
              </span>
              <code>{text || " "}</code>
            </span>
          ))}
      </pre>
    </div>
  );
}

const styles = stylex.create({
  block: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    minWidth: 0,
    backgroundColor: tokens.bg,
  },
  surface: {
    position: "relative",
    display: "block",
    minWidth: 0,
    margin: 0,
    overflow: "auto",
    backgroundColor: tokens.tray,
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: "12px",
    lineHeight: "19px",
  },
  line: {
    display: "grid",
    minWidth: 0,
    gridTemplateColumns: "42px 14px minmax(0, 1fr)",
    minHeight: "19px",
    whiteSpace: "pre",
  },
  gutter: {
    padding: "0 5px 0 16px",
    color: tokens.inkFaint,
    textAlign: "right",
  },
  marker: {
    color: tokens.inkFaint,
    textAlign: "center",
  },
});
