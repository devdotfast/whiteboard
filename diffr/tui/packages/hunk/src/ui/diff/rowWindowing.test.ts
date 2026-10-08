import { expect, test } from "bun:test";
import { resolveVisibleRowIndexWindow as window } from "./rowWindowing";
test("window keeps wrapped rows intersecting either edge and replaces skipped height", () => {
  expect(
    window({
      bodyHeight: 12,
      rowBounds: [
        { top: 0, height: 2 },
        { top: 2, height: 5 },
        { top: 7, height: 1 },
        { top: 8, height: 4 },
      ],
      visibleBodyBounds: { top: 3, height: 5 },
    }),
  ).toEqual({
    startIndex: 1,
    endIndex: 3,
    topSpacerHeight: 2,
    bottomSpacerHeight: 4,
  });
});
test("offscreen file becomes only spacers", () => {
  expect(
    window({
      bodyHeight: 12,
      rowBounds: [{ top: 0, height: 12 }],
      visibleBodyBounds: { top: 20, height: 5 },
    }),
  ).toEqual({
    startIndex: 0,
    endIndex: 0,
    topSpacerHeight: 12,
    bottomSpacerHeight: 0,
  });
});
test("hidden structural rows at the viewport boundary retain their anchors", () => {
  expect(
    window({
      bodyHeight: 4,
      rowBounds: [
        { top: 0, height: 2 },
        { top: 2, height: 0 },
        { top: 2, height: 2 },
        { top: 4, height: 0 },
      ],
      visibleBodyBounds: { top: 2, height: 2 },
    }),
  ).toEqual({
    startIndex: 1,
    endIndex: 4,
    topSpacerHeight: 2,
    bottomSpacerHeight: 0,
  });
});
