import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { routeDocumentEmbedScroll } from "./document-embed-scroll";

let dispose: (() => void) | undefined;

afterEach(() => dispose?.());

function mount(embedClass: string, inDocument = true) {
  const region = document.createElement("section");
  region.style.cssText =
    "width:300px;height:200px;overflow:auto;line-height:20px";
  region.innerHTML = `<article class="${inDocument ? "review-document" : "diagram-tour-stage"}" style="height:2000px;width:700px">
    <div class="${embedClass}" style="width:200px;height:100px;overflow:auto">
      <div style="height:600px;width:900px">Content</div>
    </div>
  </article>`;
  document.body.append(region);
  dispose = routeDocumentEmbedScroll(region);
  const embed = region.querySelector<HTMLElement>(`.${embedClass}`)!;
  const content = embed.firstElementChild!;

  return { region, embed, content };
}

it.each(["sequence-diagram", "flow-diagram", "database-lens", "code-peek"])(
  "scrolls the document vertically over %s without scrolling the embed",
  (embedClass) => {
    const { region, embed, content } = mount(embedClass);
    const embeddedWheel = vi.fn<(event: WheelEvent) => void>();
    embed.addEventListener("wheel", embeddedWheel);
    region.scrollTop = 300;
    embed.scrollTop = 50;
    embed.scrollLeft = 60;

    content.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 120,
        deltaX: 30,
      }),
    );
    expect(region.scrollTop).toBe(420);
    expect(region.scrollLeft).toBe(0);
    content.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -80 }),
    );
    expect(region.scrollTop).toBe(340);
    expect(embed.scrollTop).toBe(50);
    expect(embed.scrollLeft).toBe(60);
    expect(embeddedWheel).not.toHaveBeenCalled();
  },
);

it.each(["sequence-diagram", "flow-diagram", "database-lens", "code-peek"])(
  "leaves horizontal gestures over %s to the embed",
  (embedClass) => {
    const { region, embed, content } = mount(embedClass);
    const embeddedWheel = vi.fn<(event: WheelEvent) => void>();
    embed.addEventListener("wheel", embeddedWheel);

    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaX: 120,
      deltaY: 20,
    });

    content.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(false);
    expect(embeddedWheel).toHaveBeenCalledOnce();
    expect(region.scrollTop).toBe(0);
  },
);

it("routes a diagonal tie to the document, not the code peek", () => {
  const { region, embed, content } = mount("code-peek");
  const embeddedWheel = vi.fn<(event: WheelEvent) => void>();
  embed.addEventListener("wheel", embeddedWheel);
  region.scrollTop = 300;
  embed.scrollTop = 50;

  content.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaX: 1,
      deltaY: 1,
    }),
  );

  expect(region.scrollTop).toBe(301);
  expect(embed.scrollTop).toBe(50);
  expect(embeddedWheel).not.toHaveBeenCalled();
});

it("scrolls a wide sequence diagram horizontally with a trackpad gesture", async () => {
  const { region, embed, content } = mount("sequence-diagram");

  await userEvent.wheel(content, { delta: { x: 120, y: 0 } });

  await vi.waitFor(() => expect(embed.scrollLeft).toBeGreaterThan(0));
  expect(region.scrollTop).toBe(0);
});

it.each([
  ["Shift-wheel", { shiftKey: true }],
  ["Cmd-wheel", { metaKey: true }],
  ["Ctrl-wheel", { ctrlKey: true }],
])("leaves %s to the embed", (_name, modifiers) => {
  const { region, embed, content } = mount("sequence-diagram");
  const embeddedWheel = vi.fn<(event: WheelEvent) => void>();
  embed.addEventListener("wheel", embeddedWheel);

  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
    ...modifiers,
  });

  content.dispatchEvent(wheel);

  expect(wheel.defaultPrevented).toBe(false);
  expect(embeddedWheel).toHaveBeenCalledOnce();
  expect(region.scrollTop).toBe(0);
});

it("normalizes line and page wheel deltas", () => {
  const { region, content } = mount("code-peek");
  content.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 3,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
    }),
  );
  expect(region.scrollTop).toBe(60);
  content.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 1,
      deltaMode: WheelEvent.DOM_DELTA_PAGE,
    }),
  );
  expect(region.scrollTop).toBe(60 + region.clientHeight);
});

it("leaves fullscreen tours and pinch-to-zoom alone", () => {
  const { region, content } = mount("sequence-diagram", false);

  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
  });

  content.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(region.scrollTop).toBe(0);
  region.firstElementChild!.className = "review-document";

  const pinch = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
    ctrlKey: true,
  });

  content.dispatchEvent(pinch);
  expect(pinch.defaultPrevented).toBe(false);
  expect(region.scrollTop).toBe(0);
});

it("continues scrolling the document when the embed fits and removes the handler on cleanup", () => {
  const { region, embed, content } = mount("sequence-diagram");
  (content as HTMLElement).style.cssText = "height:20px;width:20px";
  expect(embed.scrollHeight).toBe(embed.clientHeight);
  content.dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 }),
  );
  expect(region.scrollTop).toBe(80);
  dispose?.();

  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
  });

  content.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(region.scrollTop).toBe(80);
});
