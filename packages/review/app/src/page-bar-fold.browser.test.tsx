import { act, useRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { usePageBarFold } from "./page-bar-fold";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

let showPlace: () => void = () => {};

/** A page bar 300px wide whose breadcrumb's counter loads after it opens. */
function Bar({ onFold }: { onFold: (fold: number) => void }) {
  const header = useRef<HTMLElement>(null);
  const [placed, setPlaced] = useState(false);

  showPlace = () => setPlaced(true);
  onFold(usePageBarFold(header, true));

  return (
    <header
      ref={header}
      style={{ display: "flex", width: 300, columnGap: 8, padding: 0 }}
    >
      <nav data-page-bar-crumb="" style={{ display: "flex", minWidth: 0 }}>
        <span>Plan</span>
        {placed && (
          <span data-page-bar-counter="" style={{ width: 120, flex: "none" }}>
            3 of 8
          </span>
        )}
      </nav>
      <div style={{ display: "flex", columnGap: 8, flex: "none" }}>
        <button data-page-bar-fold="chat" style={{ width: 60 }} />
        <button data-page-bar-fold="share" style={{ width: 60 }} />
      </div>
    </header>
  );
}

it("folds again when the breadcrumb's counter arrives after the first measure", async () => {
  const folds: number[] = [];
  const page = document.createElement("div");

  document.body.append(page);
  root = createRoot(page);
  await act(async () =>
    root?.render(<Bar onFold={(fold) => folds.push(fold)} />),
  );
  await vi.waitFor(() => expect(folds.at(-1)).toBe(0));

  await act(async () => showPlace());

  // 48 for the crumb, 128 for the counter, 136 for the icons: over 300.
  await vi.waitFor(() => expect(folds.at(-1)).toBe(1));
});

/** A page bar `width` wide: a parent, then a switcher naming a board. */
function SwitcherBar({
  width,
  onFold,
}: {
  width: number;
  onFold: (fold: number) => void;
}) {
  const header = useRef<HTMLElement>(null);
  const fold = usePageBarFold(header, true);

  onFold(fold);

  return (
    <header ref={header} style={{ display: "flex", width, columnGap: 8 }}>
      <nav
        data-page-bar-crumb=""
        style={{ display: "flex", minWidth: 0, columnGap: 6 }}
      >
        <span style={{ minWidth: 0, overflow: "hidden" }}>Parent</span>
        <span
          data-page-bar-switcher=""
          style={{ display: "flex", minWidth: 0 }}
        >
          <button style={{ display: "flex", minWidth: 0, columnGap: 4 }}>
            <span
              data-page-bar-truncates=""
              style={{ minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}
            >
              <span style={{ display: "inline-block", width: 100 }} />
            </span>
            {fold < 1 && (
              <span
                data-page-bar-counter=""
                style={{ width: 60, flex: "none" }}
              />
            )}
          </button>
        </span>
      </nav>
      <div style={{ display: "flex", flex: "none" }} />
    </header>
  );
}

it("drops the switcher's count before its board's name gives way", async () => {
  const folds: number[] = [];
  const page = document.createElement("div");

  document.body.append(page);
  root = createRoot(page);

  // Room for the parent's minimum, the whole name and the count.
  await act(async () =>
    root?.render(
      <SwitcherBar width={400} onFold={(fold) => folds.push(fold)} />,
    ),
  );
  await vi.waitFor(() => expect(folds.at(-1)).toBe(0));

  // Not enough for the name and the count: the count goes first.
  await act(async () =>
    root?.render(
      <SwitcherBar width={200} onFold={(fold) => folds.push(fold)} />,
    ),
  );
  await vi.waitFor(() => expect(folds.at(-1)).toBe(1));
});
