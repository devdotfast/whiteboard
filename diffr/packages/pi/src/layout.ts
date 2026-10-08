import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";

/** Public overlay lifecycle only: Pi keeps ownership of its chat layout and focus. */
export function mountPane(ui: ExtensionContext["ui"], create: (tui: TUI, full: boolean) => Component,
  initialFull: boolean, capture: boolean) {
  let full = initialFull;
  let handle: OverlayHandle | undefined;
  let closed = false;
  let switching = false;
  const show = (focus: boolean) => new Promise<void>((resolve, reject) => {
    // Pi's custom done() pops the top overlay, which may belong to another
    // extension. The public handle removes this specific overlay instead.
    // We own readiness separately; no caller waits for custom's result.
    void ui.custom<void>((tui) => create(tui, full), { overlay: true,
      overlayOptions: { width: full ? "100%" : "60%", minWidth: full ? 1 : 50,
        maxHeight: full ? "100%" : "75%", anchor: "top-right", nonCapturing: !focus },
      onHandle(next) {
        handle = next;
        if (closed) { next.hide(); handle = undefined; }
        resolve();
      },
    }).catch(reject);
  });
  const ready = show(capture);
  const remove = () => { handle?.hide(); handle = undefined; };
  return {
    ready,
    get fullscreen() { return full; },
    focus() { if (!closed) { handle?.setHidden(false); handle?.focus(); } },
    focusChat() {
      if (full) handle?.setHidden(true);
      handle?.unfocus();
    },
    async toggle() {
      if (closed || switching) return;
      switching = true;
      try {
        // Let Pi finish dispatching the current mouse event before it removes its target.
        await ready;
        if (closed) return;
        remove();
        full = !full;
        await show(true);
      } finally { switching = false; }
    },
    dispose() { closed = true; remove(); },
  };
}
