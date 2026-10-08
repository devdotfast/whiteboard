import { expect, test } from "bun:test";
import { PointerInput } from "./pointer";
import type { Frame } from "./protocol";

const frame: Frame = { colors: [], fg: 0, hover: null, lines: [
  { bg: 0, segments: [], hits: [[0, 3, { fold: 1, file: 0 }]] },
  { bg: 0, segments: [] },
] };

test("fold presses cannot accidentally start a source selection", () => {
  const pointer = new PointerInput();
  expect(pointer.read(frame, { type: "down", x: 1, y: 0, alt: true })).toEqual({ input: { act: { fold: 1, file: 0 }, alt: true } });
  expect(pointer.read(frame, { type: "drag", x: 8, y: 1 })).toEqual({});
});

test("source drags extend only between press and release", () => {
  const pointer = new PointerInput();
  expect(pointer.read(frame, { type: "down", x: 8, y: 0 }).input).toEqual({ select: { x: 8, y: 0 } });
  expect(pointer.read(frame, { type: "drag", x: 9, y: 1 }).input).toEqual({ select: { x: 9, y: 1, extend: true } });
  pointer.read(frame, { type: "up", x: 9, y: 1 });
  expect(pointer.read(frame, { type: "drag", x: 8, y: 0 })).toEqual({});
});
