import * as stylex from "@stylexjs/stylex";

/** A top bar surface tab; its marker underline draws while it is hovered. */
export const segmentMarker = stylex.defineMarker();

/** The button a disclosure chevron sits in; the chevron inks on its hover. */
export const chevronMarker = stylex.defineMarker();

/** A call tree's call-site edge; its highlight draws while it is hovered. */
export const callEdgeMarker = stylex.defineMarker();

/** A lens filter toggle; the clear mark washes while it is hovered. */
export const lensToggleMarker = stylex.defineMarker();

/** An agent trace tool call; its chevron turns and figure shows while open. */
export const traceToolMarker = stylex.defineMarker();

/** An agent trace tool run; its chevron turns and body shows while open. */
export const traceGroupMarker = stylex.defineMarker();

/** An agent trace turn's work; its chevron turns and body shows while open. */
export const traceWorkedMarker = stylex.defineMarker();

/** An agent trace gap or collapse row; its chip inks while it is hovered. */
export const traceRowMarker = stylex.defineMarker();
