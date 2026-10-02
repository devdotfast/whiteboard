import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useFollowLatest } from "./use-follow-latest";

function Thread({
  lines,
  asking = false,
}: {
  lines: number;
  asking?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const latest = useFollowLatest(scroller, [lines]);

  return (
    <>
      <div
        ref={scroller}
        data-testid="thread"
        style={{ height: 200, overflowY: "auto" }}
        onScroll={latest.onScroll}
        onScrollEnd={latest.onScrollEnd}
      >
        {Array.from({ length: lines }, (_, line) => (
          <p key={line} style={{ height: 20, margin: 0 }}>
            Line {line}
          </p>
        ))}
      </div>
      {latest.atLatest ? null : (
        <button type="button" onClick={() => latest.jump()}>
          Latest
        </button>
      )}
      {asking ? (
        <button type="button" onClick={() => latest.jump("instant")}>
          Send
        </button>
      ) : null}
    </>
  );
}

const frame = () => act(() => new Promise(requestAnimationFrame));

it("follows new lines at the newest, stays where the reader scrolled up to, and jumps back", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const render = (lines: number) =>
    act(async () => root.render(<Thread lines={lines} />));

  await render(30);

  const thread = container.querySelector<HTMLElement>(
    '[data-testid="thread"]',
  )!;

  const end = () => thread.scrollHeight - thread.clientHeight;
  const jump = () => container.querySelector("button");

  expect(thread.scrollTop).toBe(end());

  // At the newest, it follows what streams in.
  await render(40);
  expect(thread.scrollTop).toBe(end());
  expect(jump()).toBeNull();

  // Scrolled up, the reader stays put, and can go back.
  thread.scrollTop = 100;
  await frame();
  await frame();
  await render(50);
  expect(thread.scrollTop).toBe(100);
  expect(jump()).not.toBeNull();

  await act(async () => jump()!.click());
  await vi.waitFor(() => expect(thread.scrollTop).toBe(end()));
  await frame();

  // Back at the newest, it follows again.
  await render(60);
  expect(thread.scrollTop).toBe(end());
  expect(jump()).toBeNull();

  await act(async () => root.unmount());
});

it("takes the reader to what they asked, and keeps following as it arrives", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const render = (lines: number) =>
    act(async () => root.render(<Thread lines={lines} asking />));

  await render(30);

  const thread = container.querySelector<HTMLElement>(
    '[data-testid="thread"]',
  )!;

  const end = () => thread.scrollHeight - thread.clientHeight;

  const button = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (element) => element.textContent === name,
    );

  thread.scrollTop = 100;
  await frame();
  await frame();

  await act(async () => button("Send")!.click());
  // The question, then the answer, land after the send.
  await render(32);
  await render(40);
  await frame();
  expect(thread.scrollTop).toBe(end());
  expect(button("Latest")).toBeUndefined();

  // The arrow's smooth jump lands on the end, though lines arrive during it.
  thread.scrollTop = 100;
  await frame();
  await frame();
  await act(async () => button("Latest")!.click());
  await render(46);
  await render(52);
  await vi.waitFor(() => expect(thread.scrollTop).toBe(end()));
  await frame();
  await render(58);
  expect(thread.scrollTop).toBe(end());

  await act(async () => root.unmount());
});
