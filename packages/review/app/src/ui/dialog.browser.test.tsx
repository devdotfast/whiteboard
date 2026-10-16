import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { Dialog } from "./dialog";

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

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Dialog
          aria-labelledby="title"
          closedby="any"
          onClose={() => setOpen(false)}
        >
          <h2 id="title">Title</h2>
          <textarea aria-label="Notes" />
          <button type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        </Dialog>
      )}
    </div>
  );
}

const dialog = () => container.querySelector("dialog");

const opener = () => container.querySelector<HTMLButtonElement>("button")!;

async function open() {
  await act(async () => root.render(<Fixture />));
  opener().focus();
  await act(async () => opener().click());
}

it("opens modal and focuses its first control", async () => {
  await open();
  expect(dialog()?.matches(":modal")).toBe(true);
  expect(document.activeElement).toBe(container.querySelector("textarea"));
});

it("closes on Escape and returns focus to the opener", async () => {
  await open();
  await userEvent.keyboard("{Escape}");
  await expect.poll(dialog).toBeNull();
  expect(document.activeElement).toBe(opener());
});

it("returns focus to the opener when its owner unmounts it", async () => {
  await open();
  await act(async () => dialog()!.querySelectorAll("button")[0]!.click());
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(opener());
});

it("closes on a press outside with closedby any", async () => {
  await open();
  await userEvent.click(dialog()!, { position: { x: -20, y: -20 } });
  await expect.poll(dialog).toBeNull();
  expect(document.activeElement).toBe(opener());
});
