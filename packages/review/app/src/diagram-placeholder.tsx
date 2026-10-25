import { space } from "@canvas/scale.stylex";
import { surfaceStyles } from "@canvas/ui/surface";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

import { DiagramHeader } from "./diagram-header";
import { drawStyles } from "./draw-styles";
import { tokens } from "./tokens.stylex";
import { useHydrated } from "./use-hydrated";

/** Diagrams lay out against the DOM, so a server render and hydration show
 * this frame at about the diagram's size; the diagram draws after. */
export function ClientDiagram({
  kind,
  title,
  height,
  children,
}: {
  kind: string;
  title?: string;
  height: number;
  children: ReactNode;
}) {
  if (useHydrated()) return children;

  return (
    <figure
      {...stylex.props(
        surfaceStyles.card,
        styles.figure,
        drawStyles.blockChild,
      )}
      aria-label={title}
      aria-busy
      data-diagram-placeholder={kind}
    >
      <DiagramHeader kind={kind} title={title} />
      <div {...stylex.props(styles.body)} style={{ height }} />
    </figure>
  );
}

const styles = stylex.create({
  figure: {
    margin: `${space.s18} 0 ${space.s4}`,
  },
  body: {
    backgroundColor: tokens.surface,
    backgroundImage: tokens.boardGrid,
    backgroundRepeat: "repeat",
  },
});
