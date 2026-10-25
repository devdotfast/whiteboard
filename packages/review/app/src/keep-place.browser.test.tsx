import { act, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { useKeepPlace } from "./keep-place";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function Board() {
  const region = useRef<HTMLElement>(null);

  useKeepPlace(region);

  return (
    <section
      ref={region}
      style={{
        position: "relative",
        height: "400px",
        overflowY: "auto",
        width: "600px",
      }}
    >
      {Array.from({ length: 60 }, (_, index) => (
        <p key={index}>
          Paragraph {index + 1} has words enough to wrap onto more lines when
          the board is narrow, as it is beside an open column.
        </p>
      ))}
    </section>
  );
}

const frame = () =>
  act(() => new Promise((resolve) => requestAnimationFrame(resolve)));

it("keeps the selected text where it was as the board narrows and widens", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Board />));

  const region = host.querySelector("section")!;
  const paragraph = region.children[44]!;

  region.scrollTop = (paragraph as HTMLElement).offsetTop - 150;
  const range = document.createRange();
  range.setStart(paragraph.firstChild!, 0);
  range.setEnd(paragraph.firstChild!, 9);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  await frame();
  await frame();

  const place = () =>
    range.getBoundingClientRect().top - region.getBoundingClientRect().top;

  const before = place();

  // The Ask column opens beside the board, then closes again.
  region.style.width = "220px";
  await frame();
  await frame();
  expect(Math.abs(place() - before)).toBeLessThanOrEqual(1);

  region.style.width = "600px";
  await frame();
  await frame();
  expect(Math.abs(place() - before)).toBeLessThanOrEqual(1);
});
