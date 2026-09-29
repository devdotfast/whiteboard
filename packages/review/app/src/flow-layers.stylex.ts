import * as stylex from "@stylexjs/stylex";

// Stacking inside the React Flow canvases (the software map and diagrams),
// above React Flow's own node and edge layers.
export const flowLayer = stylex.defineConsts({
  actions: "20",
  // An edge's endpoints sit just under its label.
  edgeEndpoint: "39",
  label: "40",
  // The narrow inspector sheet and its backdrop cover the whole map.
  inspectorBackdrop: "48",
  inspector: "49",
});
