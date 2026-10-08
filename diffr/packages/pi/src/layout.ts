import { HStack, isViewportTUI, type Component, type TUI, type ViewportTUI } from "@earendil-works/pi-tui";

/**
 * Pi 0.99 exposes setLayoutRoot, but not a getter or a focus getter. Keep that
 * compatibility boundary here, and refuse to replace an unknown host layout.
 */
type LayoutHost = ViewportTUI & { layoutRoot?: Component; focusedComponent?: Component | null };
export function mountPane(tui: TUI, pane: Component) {
  if (!isViewportTUI(tui)) throw new Error("Diffr needs Pi fullscreen mode. Start with diffr-pi, or pi --tui-mode fullscreen.");
  const host = tui as LayoutHost;
  const original = host.layoutRoot;
  const focus = host.focusedComponent;
  if (!original || typeof original.render !== "function" || focus === undefined)
    throw new Error("This Pi version does not expose the layout needed for Diffr's split view.");
  const split = new HStack([
    { component: original, basis: 0, grow: 2, shrink: 1, minSize: 32, visible: size => size.width >= 100 },
    { component: { render: () => Array.from({ length: tui.terminal.rows }, () => "│"), invalidate() {} },
      basis: 1, grow: 0, shrink: 0, visible: size => size.width >= 100 },
    { component: pane, basis: 0, grow: 3, shrink: 1, minSize: 20 },
  ]);
  let full = false;
  let disposed = false;
  let root: Component = split;
  host.setLayoutRoot(root);
  tui.setFocus(pane);
  tui.requestRender();
  return {
    get fullscreen() { return full || tui.terminal.columns < 100; },
    toggle() {
      if (disposed) return;
      full = !full;
      root = full ? pane : split;
      host.setLayoutRoot(root);
      tui.setFocus(pane);
      tui.requestRender();
    },
    focus() { if (!disposed) tui.setFocus(pane); },
    focusChat() {
      if (full) { full = false; root = split; host.setLayoutRoot(root); }
      tui.setFocus(focus);
      tui.requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Another extension may have taken ownership while ours was open.
      if (host.layoutRoot === root) host.setLayoutRoot(original);
      if (host.focusedComponent === pane) tui.setFocus(focus);
      tui.requestRender();
    },
  };
}
