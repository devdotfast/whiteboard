import { chevronMarker } from "@canvas/markers.stylex";
import { motion } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { ChevronDownIcon, type IconProps } from "@canvas/ui/icons";
import * as stylex from "@stylexjs/stylex";
import type { ReactElement } from "react";

/**
 * The disclosure glyph: the chevron in a 16px slot, pointing right while closed
 * and turning down while open. Its toggle, a button with `aria-expanded` or a
 * `<summary>`, carries `chevronMarker` and takes `disclosureStyles.toggle`.
 * The workbench masks its codicon twisties to the same path (review.css).
 */
export function DisclosureChevron({ xstyle }: IconProps = {}): ReactElement {
  return <ChevronDownIcon xstyle={[styles.chevron, xstyle]} />;
}

export const disclosureStyles = stylex.create({
  toggle: {
    cursor: "pointer",
    listStyle: "none",
    textAlign: "left",
    "::-webkit-details-marker": {
      display: "none",
    },
  },
});

const styles = stylex.create({
  chevron: {
    margin: "2px",
    color: {
      default: tokens.inkFaint,
      [stylex.when.ancestor(":hover", chevronMarker)]: tokens.ink,
      [stylex.when.ancestor(":focus-visible", chevronMarker)]: tokens.ink,
    },
    transform: {
      default: "rotate(-90deg)",
      [stylex.when.ancestor(
        ':is([aria-expanded="true"], details[open] > summary)',
        chevronMarker,
      )]: "rotate(0deg)",
    },
    transitionProperty: "transform, color",
    transitionDuration: {
      default: motion.fast,
      [stylex.env.reducedMotion]: motion.instant,
    },
    transitionTimingFunction: motion.ease,
  },
});
