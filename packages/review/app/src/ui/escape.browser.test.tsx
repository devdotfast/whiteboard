import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useEscape } from "./escape";

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

function Fixture({
  enabled,
  onEscape,
}: {
  enabled: boolean;
  onEscape: () => void;
}) {
  useEscape(onEscape, enabled);

  return <input aria-label="Field" />;
}

const press = (key: string) =>
  act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });

it("calls back on Escape only while enabled", async () => {
  const onEscape = vi.fn<() => void>();

  await act(async () => root.render(<Fixture enabled onEscape={onEscape} />));
  await press("Enter");
  expect(onEscape).not.toHaveBeenCalled();
  await press("Escape");
  expect(onEscape).toHaveBeenCalledOnce();

  await act(async () =>
    root.render(<Fixture enabled={false} onEscape={onEscape} />),
  );
  await press("Escape");
  expect(onEscape).toHaveBeenCalledOnce();
});

it("uses the latest callback", async () => {
  const first = vi.fn<() => void>();
  const second = vi.fn<() => void>();

  await act(async () => root.render(<Fixture enabled onEscape={first} />));
  await act(async () => root.render(<Fixture enabled onEscape={second} />));
  await press("Escape");
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});
