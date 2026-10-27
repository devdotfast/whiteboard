import { Whiteboard, WhiteboardProvider } from "@canvas/whiteboard";
import { settled } from "@canvas/whiteboard-fixture";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { openShare } from "./open-share";
import { shareFixture } from "./share-fixture";

import "@canvas/styles.css";

const cleanup: Array<() => void> = [];

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await act(dispose);
  vi.restoreAllMocks();
});

it("hydrates a server-rendered share, then draws its diagram and peeks", async () => {
  const view = await openShare(shareFixture);

  cleanup.push(() => view.dispose());

  const board = (
    <div className="review-canvas-root">
      <WhiteboardProvider data={view.data} host={view.host} settings={{}}>
        <Whiteboard />
      </WhiteboardProvider>
    </div>
  );

  const container = document.createElement("div");
  container.innerHTML = renderToString(board);
  document.body.append(container);
  cleanup.push(() => container.remove());

  const serverPeek = container.querySelector(
    '[data-review-node-id="peek"] [data-review-inline-editor] > div',
  );

  expect(serverPeek?.textContent).toContain("// sent once written");

  const shot = () =>
    container.querySelector(
      '[data-review-node-id="shot"] img[alt="The queue"]',
    );

  expect(shot()).not.toBeNull();
  expect(shot()?.hasAttribute("src")).toBe(false);

  const peekBox = () =>
    container
      .querySelector(
        '[data-review-node-id="peek"] [data-review-inline-editor]',
      )!
      .getBoundingClientRect().height;

  const serverHeight = peekBox();
  expect(container.querySelector("[data-diagram-placeholder]")).not.toBeNull();

  const errors: string[] = [];
  const logError = console.error;

  // React reports a mismatch here in development builds.
  vi.spyOn(console, "error").mockImplementation((...args) => {
    const message = args.map(String).join(" ");

    if (/hydrat/i.test(message)) errors.push(message);
    else logError(...args);
  });

  await act(async () => {
    const root = hydrateRoot(container, board, {
      onRecoverableError: (error) => errors.push(String(error)),
    });

    cleanup.push(() => root.unmount());
  });

  // The diagram replaces its placeholder, and the host's live peek takes
  // over the server's markup.
  expect(
    await settled(() =>
      container.querySelector('[data-review-node-id="flow"] .react-flow'),
    ),
  ).toBeTruthy();

  expect(container.querySelector("[data-diagram-placeholder]")).toBeNull();
  expect(
    container.querySelector('[data-review-node-id="replay"] iframe'),
  ).not.toBeNull();

  const peek = container.querySelector(
    '[data-review-node-id="peek"] [data-review-inline-editor] > div',
  );

  // The default "system" theme follows the viewer's color scheme.
  expect(getComputedStyle(container.querySelector(".review-app")!).color).toBe(
    matchMedia("(prefers-color-scheme: light)").matches
      ? "rgb(21, 24, 30)"
      : "rgb(238, 240, 244)",
  );
  expect(peek).not.toBe(serverPeek);
  expect(peek?.textContent).toContain("// sent once written");
  // The live peek keeps the server's size, so nothing below it moves.
  expect(peekBox()).toBe(serverHeight);
  expect(shot()).not.toBeNull();
  expect(shot()?.hasAttribute("src")).toBe(false);
  expect(errors).toEqual([]);

  // With no container from the host, a diagram still expands over the board,
  // and closing it gives the page its scroll back.
  const scroller = container.querySelector<HTMLElement>(".review-view-region")!;
  const overflow = getComputedStyle(scroller).overflowY;

  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Expand diagram"]')!
      .click(),
  );
  expect(
    await settled(() =>
      container.querySelector('button[aria-label="Close expanded diagram"]'),
    ),
  ).toBeTruthy();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(getComputedStyle(scroller).overflowY).toBe(overflow);
});
