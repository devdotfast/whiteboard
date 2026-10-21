import { expect, it } from "vitest";

import { respellLinks } from "./document.js";

it("respells retired links in destinations and definitions", () => {
  expect(
    respellLinks(
      "See [a](review-source:head/a.ts#L1).\n\n   [b]: <review-trace:t#e1>\n[c]: review-source:head/c.ts",
    ),
  ).toBe(
    "See [a](whiteboard:source/head/a.ts#L1).\n\n   [b]: <whiteboard:trace/t#e1>\n[c]: whiteboard:source/head/c.ts",
  );
});

it("leaves an indented code line alone", () => {
  expect(respellLinks("    [a]: review-source:head/a.ts")).toBe(
    "    [a]: review-source:head/a.ts",
  );
});

// A shared board's Markdown is someone else's; Desktop and the web viewer
// respell it before any schema check.
it("reads blank lines in linear time", () => {
  const blank = " \n".repeat(200_000);
  const start = performance.now();

  expect(respellLinks(blank)).toBe(blank);
  expect(performance.now() - start).toBeLessThan(1_000);
});
