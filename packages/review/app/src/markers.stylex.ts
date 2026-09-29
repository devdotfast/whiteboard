import * as stylex from "@stylexjs/stylex";

/** A top bar surface tab; its marker underline draws while it is hovered. */
export const segmentMarker = stylex.defineMarker();

/** The button a disclosure chevron sits in; the chevron inks on its hover. */
export const chevronMarker = stylex.defineMarker();

/** A call tree's call-site edge; its highlight draws while it is hovered. */
export const callEdgeMarker = stylex.defineMarker();

/** A lens filter toggle; the clear mark washes while it is hovered. */
export const lensToggleMarker = stylex.defineMarker();
