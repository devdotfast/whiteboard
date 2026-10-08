import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";

/** Public overlay lifecycle only: Pi keeps ownership of its chat layout and focus. */
export function mountPane(ui: ExtensionContext["ui"], create: (tui: TUI, full: boolean) => Component,
  initialFull: boolean, capture: boolean) {
  let full = initialFull;
  let handle: OverlayHandle | undefined;
  let finish: (() => void) | undefined;
  let closed = false;
  let switching = false;
  let completion: Promise<void> = Promise.resolve();
  const show = (focus: boolean) => new Promise<void>((resolve, reject) => {
    completion = ui.custom<void>((tui, _theme, _keys, done) => {
      finish = () => done();
      return create(tui, full);
    }, { overlay: true,
      overlayOptions: { width: full ? "100%" : "60%", minWidth: full ? 1 : 50,
        maxHeight: full ? "100%" : "75%", anchor: "top-right", nonCapturing: !focus },
      onHandle(next) {
        handle = next;
        if (closed) finish?.();
        resolve();
      },
    });
    // Pi skips onHandle when done() runs before the component mounts.
    void completion.then(resolve, reject);
  });
  return {
    ready: show(capture),
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
        await Promise.resolve();
        if (closed) return;
        finish?.();
        await completion;
        if (closed) return;
        full = !full;
        await show(true);
      } finally { switching = false; }
    },
    dispose() { closed = true; finish?.(); },
  };
}
