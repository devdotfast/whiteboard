import type {
  ReviewCanvasUi,
  ReviewMenuRequest,
} from "@dev.fast/review-protocol";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CanvasUiContext } from "./host/canvas-ui";
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

async function render(ui?: ReviewCanvasUi) {
  const change = vi.fn<(value: string) => void>();
  await act(async () =>
    root.render(
      <CanvasUiContext.Provider value={ui}>
        <OptionMenu
          ariaLabel="Sort"
          value="new"
          options={[
            { value: "new", label: "Newest" },
            { value: "old", label: "Oldest" },
          ]}
          onChange={change}
          className="sort"
          triggerClassName="sort-trigger"
        >
          Sort
        </OptionMenu>
      </CanvasUiContext.Provider>,
    ),
  );

  return {
    change,
    trigger: container.querySelector<HTMLButtonElement>("button")!,
  };
}

it.each(["ArrowDown", "ArrowUp"])(
  "%s delegates opening and selection to the host with checked state",
  async (key) => {
    let request!: ReviewMenuRequest;
    const dispose = vi.fn<() => void>();

    const { trigger, change } = await render({
      showMenu: (value) => {
        request = value;

        return { dispose };
      },
    });

    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      ),
    );
    expect(request.anchor).toBe(trigger);
    expect(request.items.find((item) => item.checked)?.id).toBe("new");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await act(async () => {
      request.onHide();
      await request.onSelect("old");
    });
    expect(change).toHaveBeenCalledExactlyOnceWith("old");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => root.render(null));
    expect(dispose).toHaveBeenCalledOnce();
  },
);

it("host cancellation leaves the selection unchanged", async () => {
  let request!: ReviewMenuRequest;

  const { trigger, change } = await render({
    showMenu: (value) => {
      request = value;

      return { dispose() {} };
    },
  });

  await act(async () => trigger.click());
  await act(async () => request.onHide());
  expect(change).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("does not reopen an already open host menu", async () => {
  const showMenu = vi.fn<ReviewCanvasUi["showMenu"]>(() => ({ dispose() {} }));
  const { trigger } = await render({ showMenu });
  await act(async () => trigger.click());
  await act(async () => trigger.click());
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(showMenu).toHaveBeenCalledOnce();
});
