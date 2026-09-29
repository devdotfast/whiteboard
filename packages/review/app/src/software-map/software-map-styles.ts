import { drawStyles } from "@canvas/draw-styles";
import { withClass } from "@canvas/stylex-props";
import { tokens } from "@canvas/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

const inDocument = ":is(.review-document *)";

const narrow = "@media (max-width: 720px)";

const documentWidth = `calc(100cqi - ${tokens.reviewDocumentPaddingInline} - ${tokens.reviewDocumentPaddingInline})`;

/**
 * The map's section, shared by the map and its unavailable notice. The
 * `software-map` class stays as the e2e journeys' and tests' hook.
 */
export function softwareMapRootProps(className?: string, variant?: "view") {
  return withClass(
    ["software-map", className].filter(Boolean).join(" "),
    styles.root,
    variant === "view" && styles.view,
    drawStyles.blockChild,
  );
}

const styles = stylex.create({
  root: {
    margin: "24px 0",
    fontFamily: tokens.fontMono,
    // In a document the map centers on the prose column, never narrower than
    // the prose measure.
    width: {
      default: null,
      [inDocument]: { default: "fit-content", [narrow]: "calc(100cqi - 16px)" },
    },
    maxWidth: {
      default: null,
      [inDocument]: {
        default: `min(${tokens.reviewInlineDiagramMaxWidth}, ${documentWidth})`,
        [narrow]: "none",
      },
    },
    minWidth: {
      default: null,
      [inDocument]: `min(${tokens.reviewProseMaxWidth}, ${documentWidth})`,
    },
    marginInline: { default: null, [inDocument]: "auto" },
  },
  // The map view fills its canvas shell.
  view: {
    flex: 1,
    minHeight: 0,
    height: "100%",
    margin: 0,
  },
});
