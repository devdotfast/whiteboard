import { expect, test } from "vitest";
import { splitArgs } from "./args";

test("arguments split on whitespace, and quotes keep spaces in one", () => {
  expect(splitArgs("")).toEqual([]);
  expect(splitArgs("  main  HEAD -- src ")).toEqual(["main", "HEAD", "--", "src"]);
  expect(splitArgs(`HEAD -- "with space/a.ts" 'it''s'`)).toEqual(["HEAD", "--", "with space/a.ts", "its"]);
  expect(splitArgs(`""`)).toEqual([""]);
  expect(() => splitArgs(`"open`)).toThrow("Unclosed");
});
