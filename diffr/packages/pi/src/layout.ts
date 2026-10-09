import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, TUI, TuiAltScreen } from "@earendil-works/pi-tui";
import { paneKey } from "./keys";

/** A public widget reserves space above the native editor and below the transcript. */
export function mountPane(ui: ExtensionContext["ui"],
  create: (tui: TUI, expanded: () => boolean, focused: () => boolean) => Component,
  initialExpanded: boolean, capture: boolean) {
  let expanded = initialExpanded;
  let closed = false;
  // Missing from Pi 0.99's TUI interface.
  let terminal: TUI & Pick<TuiAltScreen, "getFocusedComponent">;
  let widget: Component & Focusable;
  let draft: Component | null;
  let blur = () => {};
  const repaint = () => terminal?.requestRender();
  const focused = () => terminal?.getFocusedComponent() === widget;
  const focusChat = () => {
    // Do not dismiss another extension's dialog when it takes focus.
    if (focused()) terminal.setFocus(draft);
    repaint();
  };
  const focus = () => {
    if (closed || focused() || terminal.hasOverlay()) return;
    draft = terminal.getFocusedComponent();
    terminal.setFocus(widget);
    repaint();
  };
  ui.setWidget("diffr", tui => {
    terminal = tui as typeof terminal;
    draft = terminal.getFocusedComponent();
    const component = create(tui, () => expanded, focused);
    widget = {
      get focused() { return focused(); },
      set focused(value: boolean) { if (!value) blur(); },
      render: width => component.render(width),
      invalidate: () => component.invalidate(),
      handleInput: data => component.handleInput?.(data),
      handleMouse(event) {
        if (closed) return;
        if (event.type === "press" && event.button === "left") focus();
        // An action can return focus to the draft (Add to chat) or close the pane.
        // Do not let the subsequent dispatch result focus the widget again.
        const result = component.handleMouse?.(event);
        return result ? { ...result, focus: false } : undefined;
      },
    } satisfies Component & Focusable;
    return widget;
  });
  if (capture) focus();
  const removeInput = ui.onTerminalInput(data => {
    if (closed || terminal.hasOverlay()) return;
    const key = paneKey(data);
    if (!key) return;
    if (key.key === "f7") { focus(); return { consume: true }; }
    if (!focused()) return;
    if (key.key === "escape") { focusChat(); return { consume: true }; }
    if (key.key === "f6") { expanded = !expanded; repaint(); return { consume: true }; }
    const viewerModifier = (key.ctrl && ["p", "n", "c", "g", "d", "u", "f", "b"].includes(key.key))
      || (key.meta && ["p", "b", "l"].includes(key.key));
    if ((key.ctrl || key.meta) && !viewerModifier) focusChat();
    // Pi dispatches ordinary input to its actual focused component.
  });
  return {
    onBlur(fn: () => void) { blur = fn; },
    focus,
    focusChat,
    toggle() {
      if (closed) return;
      expanded = !expanded;
      focus();
      repaint();
    },
    dispose() {
      if (closed) return;
      focusChat();
      closed = true;
      removeInput();
      ui.setWidget("diffr", undefined);
      repaint();
    },
  };
}
