/** TeX math in a Markdown block must typeset in the Desktop, inside the workbench's content security policy. */
import assert from "node:assert/strict";

import { createReview } from "../harness.mjs";

export const name = "math-rendering";

export const phase = 1;

export const options = {};

const tex = String.raw;

// Each sized delimiter draws from a font of its own, the smallest of them under Vite's inlining limit.
const FONTS = [
  "KaTeX_Main",
  "KaTeX_Math",
  "KaTeX_AMS",
  "KaTeX_Caligraphic",
  "KaTeX_Size1",
  "KaTeX_Size2",
  "KaTeX_Size3",
  "KaTeX_Size4",
];

const MATH = [
  tex`Dollar $e^{i\pi} + 1 = 0$ and paren \(\mathbb{R} \ni x\) inline.`,
  "",
  "$$",
  tex`\int_0^\infty e^{-x^2}\,dx = \Biggl( \biggl( \Bigl( \bigl( \frac{\sqrt{\pi}}{2} \bigr) \Bigr) \biggr) \Biggr)`,
  "$$",
  "",
  tex`\[`,
  tex`\mathcal{L} = \begin{pmatrix} a & b \\ c & d \end{pmatrix} \sum_{k=1}^{n} \braket{\psi_k | \phi}`,
  tex`\]`,
  "",
  "$$",
  Array.from({ length: 60 }, (_, index) => `x_{${index}}`).join(" + "),
  "$$",
  "",
  tex`It costs $5 and $10, see \[1\].`,
].join("\n");

export async function run(ctx) {
  const { canvas } = await createReview(ctx, {
    title: "Math e2e",
    blocks: [
      {
        type: "section",
        title: "Equations",
        children: [{ type: "markdown", markdown: MATH }],
      },
    ],
  });

  const page = canvas.page();

  await ctx.watchPage(page);
  await ctx.until(
    async () => (await canvas.locator(".katex").count()) === 5,
    "five typeset equations",
  );
  assert.equal(await canvas.locator(".katex-display").count(), 3);
  assert.equal(await canvas.locator(".katex-error").count(), 0);
  await canvas.getByText("It costs $5 and $10, see [1].").waitFor();
  ctx.check("dollar, paren and bracket math typesets; prose stays prose");

  // A font the policy refuses ends in "error" and never loads, so waiting on the loaded ones alone would only time out.
  const fonts = await ctx.until(async () => {
    const faces = await page.evaluate(() =>
      [...document.fonts].map((font) => ({
        family: font.family.replaceAll('"', ""),
        status: font.status,
      })),
    );

    const families = (status) =>
      faces.filter((face) => face.status === status).map((face) => face.family);

    const refused = families("error");

    return refused.length > 0 ||
      FONTS.every((family) => families("loaded").includes(family))
      ? { refused }
      : null;
  }, "the math fonts to load");

  assert.deepEqual(fonts.refused, []);
  assert.deepEqual(
    ctx.requestUrls.filter((url) => /KaTeX[^/]*\.(?:woff|ttf)$/.test(url)),
    [],
  );
  ctx.check("math fonts load, as woff2 alone");

  const layout = await page.evaluate(() => {
    const root = document.querySelector(
      ".review-canvas-root [data-review-api]",
    );

    const wide = [...root.querySelectorAll("span:has(> .katex-display)")].at(
      -1,
    );

    return {
      drawn: [...root.querySelectorAll(".katex")]
        .map((equation) => equation.getBoundingClientRect())
        .every((box) => box.width > 0 && box.height > 0),
      scrolls: wide.scrollWidth > wide.clientWidth,
      contained:
        wide.getBoundingClientRect().right <=
        wide.parentElement.getBoundingClientRect().right + 1,
    };
  });

  assert.deepEqual(layout, { drawn: true, scrolls: true, contained: true });
  ctx.check("a wide equation scrolls inside the document");
}
