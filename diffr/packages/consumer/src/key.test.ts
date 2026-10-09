import { expect, test } from "vitest";
import { terminalKey } from "./key";

test("Kitty shifted punctuation stays printable and modifiers stay commands", () => {
  const event = { name: "/", sequence: "?", shift: true, ctrl: false, meta: false };
  expect(terminalKey(event).key).toBe("?");
  expect(terminalKey({ ...event, name: "9", sequence: "(" }).key).toBe("(");
  expect(terminalKey({ ...event, name: "l", sequence: "l", super: true })).toEqual({ key: "L", shift: true, meta: true });
  expect(terminalKey({ ...event, name: "p", sequence: "\x10", ctrl: true, shift: false })).toEqual({ key: "p", ctrl: true });
});
