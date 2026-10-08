import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { mountPane } from "./layout";

function host() {
  const mounts: { options: any; hidden: boolean; focused: boolean; closed: boolean }[] = [];
  const ui = { custom(factory: any, options: any) {
    const entry = { options: options.overlayOptions, hidden: false, focused: !options.overlayOptions.nonCapturing, closed: false };
    mounts.push(entry);
    return new Promise<void>(resolve => {
      factory({}, {}, {}, () => { entry.closed = true; resolve(); });
      queueMicrotask(() => { if (entry.closed) return; options.onHandle({
        hide: () => { entry.closed = true; },
        setHidden: (value: boolean) => { entry.hidden = value; },
        focus: () => { entry.focused = true; }, unfocus: () => { entry.focused = false; },
      }); });
    });
  } } as unknown as ExtensionContext["ui"];
  return { ui, mounts };
}
const component = () => ({ render: () => [], invalidate() {} });

test("model opens preserve focus; view switches dispose the previous overlay", async () => {
  const { ui, mounts } = host();
  const pane = mountPane(ui, component, false, false);
  await pane.ready;
  expect(mounts[0]!.focused).toBe(false);
  pane.focus();
  expect(mounts[0]!.focused).toBe(true);
  await pane.toggle();
  expect(mounts[0]!.closed).toBe(true);
  expect(mounts[1]!.options.width).toBe("100%");
  pane.focusChat();
  expect(mounts[1]!.hidden).toBe(true);
  expect(mounts[1]!.focused).toBe(false);
  pane.focus();
  expect(mounts[1]!.hidden).toBe(false);
  pane.dispose();
  expect(mounts[1]!.closed).toBe(true);
});

test("closing beneath another extension leaves its overlay and focus intact", async () => {
  const { ui, mounts } = host();
  const pane = mountPane(ui, component, false, false);
  await pane.ready;
  // Match Pi's custom done(): it removes whichever overlay was opened last.
  // Owned handles must avoid invoking that callback when closing a lower view.
  let genericCloses = 0;
  const original = ui.custom.bind(ui);
  const nestedUi = { ...ui, custom: (factory: any, options: any) => original((tui, theme, keys) =>
    factory(tui, theme, keys, () => { genericCloses++; mounts.at(-1)!.closed = true; }), options) } as typeof ui;
  const lower = mountPane(nestedUi, component, false, false);
  await lower.ready;
  const upper = mountPane(ui, component, false, true);
  await upper.ready;
  lower.dispose();
  expect(genericCloses).toBe(0);
  expect(mounts[1]!.closed).toBe(true);
  expect(mounts[2]!.closed).toBe(false);
  expect(mounts[2]!.focused).toBe(true);
  upper.dispose(); pane.dispose();
});

test("closing during mount or a view switch leaves no overlay behind", async () => {
  const { ui, mounts } = host();
  const pane = mountPane(ui, component, false, true);
  pane.dispose();
  await pane.ready;
  expect(mounts[0]!.closed).toBe(true);
  await pane.toggle();
  expect(mounts).toHaveLength(1);
  const next = mountPane(ui, component, false, true);
  await next.ready;
  const switching = next.toggle();
  next.dispose();
  await switching;
  expect(mounts).toHaveLength(2);
  expect(mounts[1]!.closed).toBe(true);
});
