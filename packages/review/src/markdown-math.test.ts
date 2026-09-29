import { describe, expect, it } from "vitest";

import { markdownNodes, parseMarkdown } from "./markdown";

const tex = String.raw;

const mathIn = (source: string) =>
  markdownNodes(parseMarkdown(source))
    .filter((node) => node.type === "math" || node.type === "inlineMath")
    .map((node) => [node.type, node.value])
    .toArray();

describe("parseMarkdown math", () => {
  it.each([
    ["dollar inline", tex`Euler: $e^{i\pi} + 1 = 0$.`, "inlineMath"],
    ["dollar display", "$$\n" + tex`e^{i\pi} + 1 = 0` + "\n$$", "math"],
    ["paren inline", tex`Euler: \( e^{i\pi} + 1 = 0 \).`, "inlineMath"],
    ["bracket display", "\\[\n" + tex`e^{i\pi} + 1 = 0` + "\n\\]", "math"],
  ])("reads %s math", (_, source, type) => {
    expect(mathIn(source)).toEqual([[type, tex`e^{i\pi} + 1 = 0`]]);
  });

  it.each([
    ["a list item", "1. Solve:\n   \\[\n   x = 1\n   \\]\n"],
    ["a block quote", "> Solve:\n> \\[\n> x = 1\n> \\]\n"],
    ["a paragraph", "Solve:\n\\[\nx = 1\n\\]\nand continue."],
  ])("reads bracket display math inside %s", (_, source) => {
    expect(mathIn(source)).toEqual([["math", "x = 1"]]);
  });

  it.each([
    ["a paragraph", "Solve:\n\n$$x = 1$$\n\nDone."],
    ["a list item", "- $$x = 1$$"],
  ])("reads one-line dollar math alone in %s as display math", (_, source) => {
    expect(mathIn(source)).toEqual([["math", "x = 1"]]);
  });

  it.each([
    ["double dollars inside a sentence", "Here $$x = 1$$ holds."],
    ["single dollars alone in a paragraph", "$x = 1$"],
  ])("keeps %s inline", (_, source) => {
    expect(mathIn(source)).toEqual([["inlineMath", "x = 1"]]);
  });

  it("reads inline math inside table cells, headings and emphasis", () => {
    expect(
      mathIn(
        [
          tex`# Energy \(E\)`,
          "",
          tex`**Mass \(m\)**`,
          "",
          "| a | b |",
          "| - | - |",
          tex`| \(x\) | $y$ |`,
        ].join("\n"),
      ).map(([, value]) => value),
    ).toEqual(["E", "m", "x", "y"]);
  });

  it("keeps TeX row breaks and escaped braces inside the math", () => {
    expect(
      mathIn(
        tex`\(\{x : x > 0\}\)` +
          "\n\\[\n" +
          tex`\begin{bmatrix} a & b \\ c & d \end{bmatrix}` +
          "\n\\]",
      ),
    ).toEqual([
      ["inlineMath", tex`\{x : x > 0\}`],
      ["math", tex`\begin{bmatrix} a & b \\ c & d \end{bmatrix}`],
    ]);
  });

  it("closes inline math at the first unescaped closer", () => {
    expect(mathIn(tex`\(a \\) b\) and \(f(x)\)`)).toEqual([
      ["inlineMath", tex`a \\) b`],
      ["inlineMath", "f(x)"],
    ]);
  });

  it.each([
    ["escaped brackets", tex`See \[1\] and \[2\].`],
    ["an unclosed opener", tex`An unclosed \( stays.`],
    ["an escaped backslash", tex`A path ends in \\(x\\).`],
    ["a code span", "Write `\\(x\\)` or `$x$`."],
    ["a code fence", "```\n\\[\nx\n\\]\n$$\ny\n$$\n```"],
  ])("reads no math from %s", (_, source) => {
    expect(mathIn(source)).toEqual([]);
  });
});
