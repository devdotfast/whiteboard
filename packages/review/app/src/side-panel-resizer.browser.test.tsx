import * as stylex from "@stylexjs/stylex";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reviewPreferenceKey } from "./host/review-client";
import { ReviewSessionProvider } from "./host/review-session";
import { testReviewSession } from "./review-session-test-utils";
import { shellStyles } from "./shell-styles";
import { useRightPanelResize } from "./side-panel-resizer";

let root: ReturnType<typeof createRoot> | undefined;

let host: HTMLDivElement | undefined;

const session = testReviewSession();

function Panel({
  stateKey,
  cramped = false,
  side = "right",
  collapsedWidth,
}: {
  stateKey: string;
  cramped?: boolean;
  side?: "left" | "right";
  collapsedWidth?: number;
}) {
  // Exercise the pre-layout path with an explicit zero-width container.
  const containerRef = useRef<HTMLElement | null>(null);

  const resize = useRightPanelResize({
    stateKey,
    side,
    defaultWidth: 360,
    minWidth: 360,
    maxWidth: 920,
    minMainWidth: 560,
    separatorWidth: 10,
    collapsedWidth,
    label: "Resize test panel",
    containerRef: cramped ? containerRef : undefined,
  });

  return (
    <section ref={containerRef} style={cramped ? { width: 0 } : undefined}>
      <div {...stylex.props(shellStyles.resizer)} {...resize.separatorProps} />
    </section>
  );
}

function separator(): HTMLDivElement {
  const element = host?.querySelector<HTMLDivElement>('[role="separator"]');

  if (!element) throw new Error("Separator not rendered.");

  return element;
}

function widenWithKeyboard() {
  act(() => {
    separator().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
  });
}

function mountPanel(
  stateKey: string,
  options: {
    cramped?: boolean;
    side?: "left" | "right";
    collapsedWidth?: number;
  } = {},
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <ReviewSessionProvider session={session}>
        <Panel
          stateKey={stateKey}
          cramped={options.cramped}
          side={options.side}
          collapsedWidth={options.collapsedWidth}
        />
      </ReviewSessionProvider>,
    );
  });
}

function unmountPanel() {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  host?.remove();
  host = undefined;
}

beforeEach(() => {
  // Control ResizeObserver delivery so the resize behavior is deterministic.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    },
  );
  window.localStorage.clear();
});

afterEach(() => {
  if (root) unmountPanel();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("useRightPanelResize persistence", () => {
  it("restores the width a reader set after the panel remounts", () => {
    mountPanel("test-panel-width");
    expect(separator().getAttribute("aria-valuenow")).toBe("360");
    widenWithKeyboard();
    expect(separator().getAttribute("aria-valuenow")).toBe("392");
    unmountPanel();

    mountPanel("test-panel-width");
    expect(separator().getAttribute("aria-valuenow")).toBe("392");
  });

  it("does not let a container too small to honour the width overwrite it", () => {
    mountPanel("test-panel-width");
    widenWithKeyboard();
    widenWithKeyboard();

    const requested = window.localStorage.getItem(
      reviewPreferenceKey("ui", "test-panel-width"),
    );

    expect(requested).toBe("424");
    unmountPanel();

    // Mounting against an unlaid-out container clamps the rendered width to the
    // minimum, but must leave the remembered width alone.
    mountPanel("test-panel-width", { cramped: true });
    expect(separator().getAttribute("aria-valuenow")).toBe("360");
    unmountPanel();

    mountPanel("test-panel-width");
    expect(separator().getAttribute("aria-valuenow")).toBe("424");
  });

  it("stores nothing for a panel the reader never resized", () => {
    mountPanel("test-panel-width");
    expect(
      window.localStorage.getItem(
        reviewPreferenceKey("ui", "test-panel-width"),
      ),
    ).toBeNull();

    widenWithKeyboard();
    expect(
      window.localStorage.getItem(
        reviewPreferenceKey("ui", "test-panel-width"),
      ),
    ).toBe("392");
  });

  it("keeps each panel's width separate", () => {
    mountPanel("test-panel-width");
    widenWithKeyboard();
    unmountPanel();

    mountPanel("other-panel-width");
    expect(separator().getAttribute("aria-valuenow")).toBe("360");
  });
});

it("grows a left sidebar toward the right and remembers its width", () => {
  mountPanel("left-sidebar", { side: "left" });
  act(() => {
    separator().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  expect(separator().getAttribute("aria-valuenow")).toBe("392");
  unmountPanel();
  mountPanel("left-sidebar", { side: "left" });
  expect(separator().getAttribute("aria-valuenow")).toBe("392");
  widenWithKeyboard();
  expect(separator().getAttribute("aria-valuenow")).toBe("360");
});

describe("useRightPanelResize folding", () => {
  const width = () => separator().getAttribute("aria-valuenow");

  function pointer(type: string, clientX: number) {
    act(() => {
      separator().dispatchEvent(
        new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }),
      );
    });
  }

  function key(key: "ArrowLeft" | "ArrowRight") {
    act(() => {
      separator().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });
  }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(
      () => {},
    );
  });

  it("folds past the minimum and reopens at the width the drag started from", () => {
    mountPanel("folding-panel", { side: "left", collapsedWidth: 42 });
    key("ArrowRight");
    expect(width()).toBe("392");
    pointer("pointerdown", 392);
    pointer("pointermove", 300);
    pointer("pointermove", 100);
    expect(width()).toBe("42");
    pointer("pointermove", 400);
    expect(width()).toBe("400");
    pointer("pointermove", 100);
    pointer("pointerup", 100);
    key("ArrowRight");
    expect(width()).toBe("392");
  });

  it("keeps the grabbed point of the divider under the pointer", () => {
    mountPanel("grab-panel", { side: "left" });
    pointer("pointerdown", 365);
    pointer("pointermove", 425);
    expect(width()).toBe("420");
  });

  it("folds from the keyboard at the minimum and stays folded after a remount", () => {
    mountPanel("folding-panel", { side: "left", collapsedWidth: 42 });
    key("ArrowLeft");
    expect(width()).toBe("42");
    unmountPanel();

    mountPanel("folding-panel", { side: "left", collapsedWidth: 42 });
    expect(width()).toBe("42");
  });
});

function HalfPanel({ containerWidth }: { containerWidth: number }) {
  const containerRef = useRef<HTMLElement | null>(null);

  const resize = useRightPanelResize({
    stateKey: `half-panel-${containerWidth}`,
    defaultWidth: 594,
    minWidth: 360,
    maxWidth: 760,
    maxContainerFraction: 0.5,
    minMainWidth: 480,
    separatorWidth: 10,
    label: "Resize half panel",
    containerRef,
  });

  return (
    <section ref={containerRef} style={{ width: containerWidth }}>
      <div {...stylex.props(shellStyles.resizer)} {...resize.separatorProps} />
    </section>
  );
}

it.each([
  { containerWidth: 1600, widest: "800" },
  { containerWidth: 1300, widest: "760" },
])(
  "grows a panel to half a $containerWidth px container, never below maxWidth",
  ({ containerWidth, widest }) => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <ReviewSessionProvider session={session}>
          <HalfPanel containerWidth={containerWidth} />
        </ReviewSessionProvider>,
      );
    });

    for (let step = 0; step < 30; step++) widenWithKeyboard();

    expect(separator().getAttribute("aria-valuenow")).toBe(widest);
    expect(separator().getAttribute("aria-valuemax")).toBe(widest);
  },
);

it("grabs past the separator into the panel, never over the scrollbar beside it", () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <div style={{ display: "flex", height: 200 }}>
        <div
          data-testid="scroller"
          style={{ flex: "1 1 0", overflowY: "scroll" }}
        >
          <div style={{ height: 2000 }} />
        </div>
        <div
          role="separator"
          {...stylex.props(shellStyles.resizer, shellStyles.resizerGrabPanel)}
        />
        <div style={{ flex: "1 1 0" }}>panel</div>
      </div>,
    );
  });

  const box = separator().getBoundingClientRect();
  const y = box.top + box.height / 2;
  const scroller = host.querySelector('[data-testid="scroller"]');

  expect(document.elementFromPoint(box.right + 6, y)).toBe(separator());
  expect(document.elementFromPoint(box.right + 12, y)).not.toBe(separator());
  expect(scroller?.contains(document.elementFromPoint(box.left - 2, y))).toBe(
    true,
  );
});
