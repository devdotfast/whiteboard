import { expect, it } from "vitest";

import { settleStreamingMarkdown } from "./streaming-markdown";

it("shows an unfinished link as its text until its target arrives", () => {
  const link = "See [the docs](https://example.com/guide)";

  const frames = [...link].map((_, index) =>
    settleStreamingMarkdown(link.slice(0, index + 1)),
  );

  // No frame shows the brackets or the target.
  expect(frames.slice(0, -1).filter((frame) => /[[\]()]/.test(frame))).toEqual(
    [],
  );
  expect(frames).toContain("See the docs");
  expect(frames.at(-1)).toBe(link);
});

it("keeps an unfinished image out, and brackets that are not links", () => {
  expect(settleStreamingMarkdown("Before ![diagram](https://exa")).toBe(
    "Before ",
  );
  expect(settleStreamingMarkdown("Reads items[0")).toBe("Reads items[0");
});

it("closes open code, bold and strikethrough", () => {
  expect(settleStreamingMarkdown("Run `pnpm bu")).toBe("Run `pnpm bu`");
  expect(settleStreamingMarkdown("It is **not safe")).toBe(
    "It is **not safe**",
  );
  expect(settleStreamingMarkdown("Was ~~right")).toBe("Was ~~right~~");
  // Stars inside code are code.
  expect(settleStreamingMarkdown("Globs `**/*.ts` and **all")).toBe(
    "Globs `**/*.ts` and **all**",
  );
});

it("leaves finished paragraphs and open code blocks alone", () => {
  const finished = "A [link](https://example.com) and **bold**.";

  expect(settleStreamingMarkdown(finished)).toBe(finished);
  expect(settleStreamingMarkdown("**Done** here.\n\nNow [the")).toBe(
    "**Done** here.\n\nNow the",
  );

  const code = "```ts\nconst link = [a](b";

  expect(settleStreamingMarkdown(code)).toBe(code);
});
