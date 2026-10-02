import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { type ReviewRoots, ReviewRootsProvider } from "./review-root-context";
import { useCanvasScrollLock } from "./use-canvas-scroll-lock";

let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function Overlay({ open }: { open: boolean }) {
  useCanvasScrollLock(open);

  return null;
}

function canvasRoots(scroller: HTMLElement): ReviewRoots {
  return {
    appRef: { current: null },
    shellRef: { current: null },
    articleRef: { current: null },
    scrollRegionRef: { current: scroller },
  };
}

it.each([0, 1])(
  "keeps overlapping overlays locked when overlay %i closes first",
  async (first) => {
    const container = document.createElement("div");
    const scroller = document.createElement("section");
    scroller.style.overflow = "auto";
    document.body.append(container, scroller);
    const roots = canvasRoots(scroller);
    root = createRoot(container);

    const render = async (open: boolean[]) =>
      act(async () =>
        root?.render(
          <StrictMode>
            <ReviewRootsProvider roots={roots}>
              <Overlay open={open[0]} />
              <Overlay open={open[1]} />
            </ReviewRootsProvider>
          </StrictMode>,
        ),
      );

    await render([true, true]);
    expect(scroller.style.overflow).toBe("hidden");
    const open = [true, true];
    open[first] = false;
    await render(open);
    expect(scroller.style.overflow).toBe("hidden");
    await render([false, false]);
    expect(scroller.style.overflow).toBe("auto");
    await render([true, false]);
    await act(async () => root?.unmount());
    root = undefined;
    expect(scroller.style.overflow).toBe("auto");
  },
);

it("locks only the owning canvas and restores each canvas independently", async () => {
  const container = document.createElement("div");
  const first = document.createElement("section");
  const second = document.createElement("section");
  first.className = second.className = "review-view-region--review";
  second.style.overflow = "scroll";
  document.body.append(container, first, second);
  root = createRoot(container);
  const firstRoots = canvasRoots(first);
  const secondRoots = canvasRoots(second);

  const render = async (firstOpen: boolean, secondOpen: boolean) =>
    act(async () =>
      root?.render(
        <>
          <ReviewRootsProvider roots={firstRoots}>
            <Overlay open={firstOpen} />
          </ReviewRootsProvider>
          <ReviewRootsProvider roots={secondRoots}>
            <Overlay open={secondOpen} />
          </ReviewRootsProvider>
        </>,
      ),
    );

  await render(false, true);
  expect(first.style.overflow).toBe("");
  expect(second.style.overflow).toBe("hidden");
  await render(true, true);
  await render(true, false);
  expect(first.style.overflow).toBe("hidden");
  expect(second.style.overflow).toBe("scroll");
  await act(async () => root?.unmount());
  root = undefined;
  expect(first.style.overflow).toBe("");
});
