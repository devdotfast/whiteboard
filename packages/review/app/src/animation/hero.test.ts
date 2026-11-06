import { expect, it } from "vitest";

import { heroFit } from "./hero";

// 1200 px wide, 820 px of room under the title.
const pane = { left: 0, width: 1200, room: 820 };

it("scales a small drawing up, within the room under the title", () => {
  expect(heroFit(pane, { left: 220, right: 500, height: 200 }).zoom).toBe(2);
  expect(
    heroFit(pane, { left: 100, right: 600, height: 400 }).zoom,
  ).toBeCloseTo(1.75);
});

it("shrinks a tall drawing a little to keep its caption in view, never past legible", () => {
  expect(heroFit(pane, { left: 0, right: 600, height: 800 }).zoom).toBeCloseTo(
    0.875,
  );
  expect(heroFit(pane, { left: 0, right: 600, height: 2000 }).zoom).toBe(0.75);
});

it("puts the drawing in the middle of the pane, wherever it sits on the stage", () => {
  const drawing = { left: 40, right: 240, height: 100 };
  const { zoom, x } = heroFit(pane, drawing);

  expect(x + zoom * drawing.left + (zoom * 200) / 2).toBeCloseTo(600);
});
