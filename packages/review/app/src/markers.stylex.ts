import * as stylex from "@stylexjs/stylex";

// A module that reuses a condition on one of these keeps it as a function,
// `const inX = () => stylex.when.ancestor(...)`, called only inside
// stylex.create: the compiler evaluates the call, and stylex.when throws at
// runtime.

/** A top bar surface tab; its marker underline draws while it is hovered. */
export const segmentMarker = stylex.defineMarker();

/** The button a disclosure chevron sits in; the chevron inks on its hover. */
export const chevronMarker = stylex.defineMarker();

/** A call tree's call-site edge; its highlight draws while it is hovered. */
export const callEdgeMarker = stylex.defineMarker();

/** A lens filter chip; its clear mark washes while it is hovered. */
export const lensChipMarker = stylex.defineMarker();

/** An agent trace tool call; its chevron turns and figure shows while open. */
export const traceToolMarker = stylex.defineMarker();

/** An agent trace tool run; its chevron turns and body shows while open. */
export const traceGroupMarker = stylex.defineMarker();

/** An agent trace turn's work; its chevron turns and body shows while open. */
export const traceWorkedMarker = stylex.defineMarker();

/** An agent trace gap or collapse row; its chip inks while it is hovered. */
export const traceRowMarker = stylex.defineMarker();

/** A software map frame; its expand button shows while it is hovered. */
export const mapFrameMarker = stylex.defineMarker();

/** A flow diagram node; its outline takes the marker while it has focus. */
export const flowNodeMarker = stylex.defineMarker();

/** A contents entry; its number inks while it is the current section. */
export const tocEntryMarker = stylex.defineMarker();

/** A review document block; its heading recomposes while it is retitled. */
export const documentNodeMarker = stylex.defineMarker();

/** The board courier's button; his tag shows while it is hovered or focused. */
export const courierMarker = stylex.defineMarker();

/** The app root; chrome and diagram borders hold only inside it. */
export const appMarker = stylex.defineMarker();

/** The top bar's left group; the surface tabs' words style only inside it. */
export const topbarTabsMarker = stylex.defineMarker();

/** The top bar's action row; its items keep their size, popovers hang below. */
export const topbarActionsMarker = stylex.defineMarker();

/** The review document article; prose styles hold only inside it. */
export const documentMarker = stylex.defineMarker();

/** A Markdown or trace quote block; paragraph and list styles hold inside it. */
export const proseMarker = stylex.defineMarker();

/** The side panel host; the panel takes its one grid cell. */
export const detailHostMarker = stylex.defineMarker();

/** The diff workspace; the courier takes its button focus ring inside it. */
export const diffWorkspaceMarker = stylex.defineMarker();

/** A commit-scoped diff view; its diff host drops below the scope bar. */
export const scopedDiffMarker = stylex.defineMarker();

/** The software map's code inspector; a code peek unclips inside it. */
export const codeInspectorMarker = stylex.defineMarker();
