import { fontSize } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { useTutorial } from "./tutorial-context";

export function TutorialViewButton({
  view,
  children,
}: {
  view: "diff";
  children?: ReactNode;
}): ReactElement | null {
  if (!useTutorial()) return null;

  // The class is the tutorial's target.
  return (
    <button
      type="button"
      {...withClass("tutorial-view-button", styles.button)}
      data-tutorial-view={view}
      onClick={() =>
        document
          .querySelector<HTMLButtonElement>(
            '.review-segment[aria-label="Diff"]',
          )
          ?.click()
      }
    >
      {children}
      <span aria-hidden="true" {...stylex.props(styles.arrow)}>
        →
      </span>
    </button>
  );
}

// A row action is marker text with an ink-faint arrow, never a box; boxes are
// for controls that act on the page.
const styles = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    margin: "6px 0 12px",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
    color: tokens.accent,
    cursor: "pointer",
    font: `${fontSize.body} ${tokens.fontMono}`,
    textDecoration: { default: null, ":hover": "underline" },
  },
  arrow: {
    color: tokens.inkFaint,
  },
});
