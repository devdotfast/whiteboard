import { act, useRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { Popover } from "./popover";

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

function Fixture() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Open
      </button>
      {open && (
        <Popover
          anchor={trigger}
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label="Panel"
        >
          <button type="button">Inside</button>
          <input
            aria-label="Nested"
            onKeyDown={(event) => {
              if (event.key === "Escape") event.stopPropagation();
            }}
          />
        </Popover>
      )}
    </div>
  );
}

const panel = () => container.querySelector('[role="dialog"]');

const trigger = () => container.querySelector<HTMLButtonElement>("button")!;

async function render() {
  await act(async () => root.render(<Fixture />));
  trigger().focus();
  await act(async () => trigger().click());
}

const press = (target: Element, key: string) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });

const pointerDown = (target: Element) =>
  act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });

it("shows in the top layer and Escape inside returns focus to the trigger", async () => {
  await render();
  expect(panel()?.matches(":popover-open")).toBe(true);

  const inside = panel()!.querySelector("button")!;
  inside.focus();
  await press(inside, "Escape");
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it("keeps open for a nested control that handles its own Escape", async () => {
  await render();
  await press(panel()!.querySelector("input")!, "Escape");
  expect(panel()).not.toBeNull();
  await press(trigger(), "Escape");
  expect(panel()).toBeNull();
});

it("closes on a press outside, even one that stops propagation", async () => {
  await render();
  await pointerDown(panel()!.querySelector("button")!);
  expect(panel()).not.toBeNull();

  const other = document.createElement("div");
  other.addEventListener("pointerdown", (event) => event.stopPropagation());
  document.body.append(other);
  await pointerDown(other);
  other.remove();
  expect(panel()).toBeNull();
});

it("closes when the window loses focus", async () => {
  await render();
  await act(async () => window.dispatchEvent(new Event("blur")));
  expect(panel()).toBeNull();
});

it("closes, not reopens, when its trigger is clicked again", async () => {
  await render();
  await pointerDown(trigger());
  await act(async () => trigger().click());
  expect(panel()).toBeNull();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});
