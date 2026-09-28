import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { SoftwareMapHotkeysTab } from "./hotkeys-tab";

let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function keysReachingWindow(init: KeyboardEventInit): Promise<number> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <SoftwareMapHotkeysTab
        groups={[]}
        activeGroupId=""
        open={false}
        ariaLabel="Hotkeys"
        onOpenChange={() => {}}
      />,
    ),
  );

  let reached = 0;
  const count = () => reached++;
  window.addEventListener("keydown", count);
  container
    .querySelector("button[aria-label='Show software map hotkeys']")
    ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  window.removeEventListener("keydown", count);

  return reached;
}

// The workbench dispatches its keybindings from a window listener.
it("lets modifier chords such as Ctrl+Tab through to the workbench", async () => {
  expect(await keysReachingWindow({ key: "Tab", ctrlKey: true })).toBe(1);
});

it("keeps plain keys from reaching the map behind it", async () => {
  expect(await keysReachingWindow({ key: "ArrowRight" })).toBe(0);
});
