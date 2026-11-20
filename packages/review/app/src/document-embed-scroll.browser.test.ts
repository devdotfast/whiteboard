import { afterEach, expect, it, vi } from "vitest";

import {
  WHEEL_GESTURE_REST_MS,
  routeDocumentEmbedScroll,
} from "./document-embed-scroll";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});

function wheel(deltaY: number) {
  return new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY });
}

function mockClock() {
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);

  return (ms: number) => {
    now += ms;
  };
}

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

it.each(["sequence-diagram", "flow-diagram"])(
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

it("leaves vertical gestures to a code peek the reader clicked into", () => {
  const { region, embed, content } = mount("code-peek");
  const embeddedWheel = vi.fn<(event: WheelEvent) => void>();
  embed.addEventListener("wheel", embeddedWheel);
  embed.tabIndex = 0;
  embed.focus();

  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: 100,
  });

  content.dispatchEvent(wheel);

  expect(wheel.defaultPrevented).toBe(false);
  expect(embeddedWheel).toHaveBeenCalledOnce();
  expect(region.scrollTop).toBe(0);
});

it("routes a diagonal tie to the document, not the diagram", () => {
  const { region, embed, content } = mount("flow-diagram");
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
  const { region, content } = mount("sequence-diagram");
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

it.each(["sequence-diagram", "flow-diagram", "database-lens", "code-peek"])(
  "leaves vertical gestures to a %s in the board block a click selected",
  (embedClass) => {
    const { region, embed, content } = mount(embedClass);

    embed.parentElement!.setAttribute("data-board-selected", "true");

    const wheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });

    content.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(region.scrollTop).toBe(0);
  },
);

it.each(["database-lens", "code-peek"])(
  "lets a gesture that starts at rest over a %s scroll it",
  (embedClass) => {
    const { region, embed, content } = mount(embedClass);
    const advance = mockClock();
    region.scrollTop = 300;

    const first = wheel(120);
    content.dispatchEvent(first);
    advance(16);
    const second = wheel(120);
    content.dispatchEvent(second);

    expect(first.defaultPrevented).toBe(false);
    expect(second.defaultPrevented).toBe(false);
    expect(region.scrollTop).toBe(300);
    expect(embed.scrollTop).toBe(0);
  },
);

it("keeps a gesture that started on the document on it over a code peek", () => {
  const { region, embed, content } = mount("code-peek");
  const advance = mockClock();

  region.firstElementChild!.dispatchEvent(wheel(40));
  advance(16);
  const over = wheel(120);
  content.dispatchEvent(over);

  expect(over.defaultPrevented).toBe(true);
  expect(region.scrollTop).toBe(120);
  expect(embed.scrollTop).toBe(0);

  advance(WHEEL_GESTURE_REST_MS + 1);
  const fresh = wheel(120);
  content.dispatchEvent(fresh);

  expect(fresh.defaultPrevented).toBe(false);
  expect(region.scrollTop).toBe(120);
});

it("scrolls the document when a code peek at rest has nothing to scroll", () => {
  const { region, content } = mount("code-peek");
  mockClock();
  (content as HTMLElement).style.cssText = "height:20px;width:20px";

  content.dispatchEvent(wheel(80));

  expect(region.scrollTop).toBe(80);
});

it("stops a latched code peek at its edge from scrolling the document", () => {
  const { region, embed, content } = mount("code-peek");
  const advance = mockClock();
  embed.scrollTop = embed.scrollHeight - embed.clientHeight;

  content.dispatchEvent(wheel(-40));
  advance(16);
  const atEdge = wheel(120);
  content.dispatchEvent(atEdge);

  expect(atEdge.defaultPrevented).toBe(true);
  expect(region.scrollTop).toBe(0);
});

it("lets a latched editor handle the wheel, then keeps the document still", () => {
  const { region, embed } = mount("code-peek");
  mockClock();
  embed.innerHTML = `<div class="monaco-scrollable-element" style="height:100px">
    <div class="lines" style="height:100px">Code</div>
    <div class="scrollbar vertical"><div class="slider" style="height:40px"></div></div>
  </div>`;
  const lines = embed.querySelector(".lines")!;
  let preventedWhenEditorSawIt: boolean | undefined;
  lines.addEventListener("wheel", (event) => {
    preventedWhenEditorSawIt = event.defaultPrevented;
  });

  const scroll = wheel(120);
  lines.dispatchEvent(scroll);

  expect(preventedWhenEditorSawIt).toBe(false);
  expect(scroll.defaultPrevented).toBe(true);
  expect(region.scrollTop).toBe(0);
});
