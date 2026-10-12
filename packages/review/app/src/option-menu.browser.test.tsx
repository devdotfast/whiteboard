import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { OptionMenu } from "./option-menu";

let container: HTMLDivElement;

let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  const change = vi.fn<(value: string) => void>();
  await act(async () =>
    root.render(
      <OptionMenu
        ariaLabel="Sort"
        value="new"
        options={[
          { value: "new", label: "Newest" },
          { value: "old", label: "Oldest" },
        ]}
        onChange={change}
      >
        Sort
      </OptionMenu>,
    ),
  );

  return {
    change,
    trigger: container.querySelector<HTMLButtonElement>("button")!,
  };
}

async function key(target: Element, key: string) {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    ),
  );
}

it.each(["ArrowDown", "ArrowUp"])(
  "%s opens the menu, focuses the selected value, and allows keyboard navigation",
  async (arrow) => {
    const { trigger, change } = await render();
    await key(trigger, arrow);

    const items = container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]',
    );

    expect(document.activeElement).toBe(items[0]);
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    await key(items[0], "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    await key(items[1], "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    await key(items[0], "End");
    expect(document.activeElement).toBe(items[1]);
    await act(async () => items[1].click());
    expect(change).toHaveBeenCalledExactlyOnceWith("old");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  },
);

it("Escape dismisses without changing the value and returns focus to the trigger", async () => {
  const { trigger, change } = await render();
  await act(async () => trigger.click());
  await key(document.activeElement!, "Escape");
  expect(change).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("outside clicks and clicking the trigger again dismiss without selecting", async () => {
  const { trigger, change } = await render();
  await act(async () => trigger.click());
  await act(async () =>
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    ),
  );
  expect(container.querySelector('[role="menu"]')).toBeNull();
  await act(async () => trigger.click());
  await act(async () => trigger.click());
  expect(container.querySelector('[role="menu"]')).toBeNull();
  expect(change).not.toHaveBeenCalled();
});
