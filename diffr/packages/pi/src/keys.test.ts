import { expect, test } from "bun:test";
import { paneKey } from "./keys";

test("Pi terminal sequences preserve Diffr's case-sensitive viewer commands", () => {
  expect(paneKey("V")?.key).toBe("V");
  expect(paneKey("\r")?.key).toBe("return");
  expect(paneKey("\x1b")).toEqual({ key: "escape" });
  expect(paneKey("\x10")).toEqual({ key: "p", ctrl: true });
});

test("Kitty releases cannot repeat a pane command", () => {
  expect(paneKey("\x1b[17;1:3~")).toBeUndefined();
  expect(paneKey("\x1b[118;2:3u")).toBeUndefined();
});
