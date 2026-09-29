import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentMarkdown, MarkdownContent } from "./agent-markdown";

let container: HTMLDivElement, root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const tex = String.raw;

const render = async (source: string) => {
  await act(async () => root.render(<MarkdownContent source={source} />));
};

const display = (source: string) => `$$\n${source}\n$$\n`;

const equations = () => [...container.querySelectorAll<HTMLElement>(".katex")];

const failures = () =>
  [...container.querySelectorAll(".katex-error")].map(
    (error) => error.textContent,
  );

const NOTATION: Array<[name: string, source: string]> = [
  [
    "fractions and roots",
    tex`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a} + \sqrt[3]{x}`,
  ],
  [
    "sums, products and limits",
    tex`\sum_{k=1}^{n} k + \prod_{i} x_i + \lim_{x \to 0} \frac{\sin x}{x}`,
  ],
  [
    "integrals",
    tex`\int_0^\infty e^{-x^2}\,dx + \iint_D f + \oint_C \vec{F} \cdot d\vec{r}`,
  ],
  [
    "derivatives",
    tex`\frac{\partial^2 u}{\partial x^2} + \nabla \cdot \vec{v} + \dot{x} + \ddot{x}`,
  ],
  [
    "Greek and operators",
    tex`\alpha \beta \Gamma \Omega \leq \geq \neq \approx \in \subseteq \forall \exists`,
  ],
  [
    "alphabets",
    tex`\mathbb{R} \mathcal{L} \mathfrak{g} \mathscr{F} \mathbf{x} \mathrm{d} \mathsf{T} \mathtt{x}`,
  ],
  [
    "accents and braces",
    tex`\hat{x} \bar{y} \tilde{z} \vec{v} \overline{AB} \underbrace{a + b}_{n} \overbrace{c}^{m}`,
  ],
  [
    "sized delimiters",
    tex`\left( \frac{a}{b} \right) \left\lvert x \right\rvert \bigl[ y \bigr] \left\langle z \right\rangle`,
  ],
  [
    "text in math",
    tex`x = 1 \text{ if } y > 0 \quad \textbf{bold} \operatorname{argmax}_x f`,
  ],
  [
    "binomials",
    tex`\binom{n}{k} + \dbinom{n}{k} + {n \choose k} + \cfrac{1}{1 + \cfrac{1}{x}}`,
  ],
  [
    "matrices",
    tex`\begin{pmatrix} a & b \\ c & d \end{pmatrix} \begin{bmatrix} 1 \\ 2 \end{bmatrix} \begin{vmatrix} x \end{vmatrix}`,
  ],
  [
    "arrays",
    tex`\left[ \begin{array}{cc|c} 1 & 0 & a \\ 0 & 1 & b \end{array} \right]`,
  ],
  ["ams align", tex`\begin{align} a &= b + c \\ d &= e \end{align}`],
  ["ams aligned", tex`\begin{aligned} a &= b \\ &= c \end{aligned}`],
  [
    "ams gather and tags",
    tex`\begin{gather} a = b \tag{1} \\ c = d \end{gather}`,
  ],
  [
    "ams cases",
    tex`f(x) = \begin{cases} x & x \geq 0 \\ -x & \text{otherwise} \end{cases}`,
  ],
  [
    "ams substack",
    tex`\sum_{\substack{i < n \\ j < m}} a_{ij} + \overset{!}{=} + \xrightarrow{f}`,
  ],
  ["boldsymbol", tex`\boldsymbol{\alpha} + \bm{x}`],
  ["braket", tex`\braket{\psi | \phi} + \bra{a} H \ket{b} + \Set{x | x > 0}`],
  ["cancel", tex`\cancel{x} + \bcancel{y} + \xcancel{z}`],
  ["color", tex`\color{red} a + \textcolor{#0969da}{b} + \colorbox{yellow}{c}`],
  [
    "mathtools",
    tex`a \coloneqq b + \begin{dcases} x \\ y \end{dcases} + \begin{pmatrix*}[r] -1 & 2 \end{pmatrix*}`,
  ],
  [
    "mathtools brackets",
    tex`\underbracket{a + b} + \overbracket{c} + \mathclap{d} + \xleftrightarrow{g}`,
  ],
  [
    "macro definitions",
    tex`\newcommand{\norm}[1]{\lVert #1 \rVert} \def\R{\mathbb{R}} \norm{x} \in \R`,
  ],
  [
    "commutative diagrams",
    tex`\begin{CD} A @>f>> B \\ @VVV @VVV \\ C @>>g> D \end{CD}`,
  ],
];

describe("math in Markdown", () => {
  it.each(NOTATION)("typesets %s", async (_, source) => {
    await render(display(source));

    expect(failures()).toEqual([]);
    expect(equations()).toHaveLength(1);

    const box = equations()[0]!.getBoundingClientRect();

    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it("typesets every delimiter style", async () => {
    await render(
      [
        tex`Dollar $a$ and paren \(b\).`,
        "",
        "$$\nc\n$$",
        "",
        "\\[\nd\n\\]",
      ].join("\n"),
    );

    expect(equations()).toHaveLength(4);
    expect(container.querySelectorAll(".katex-display")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/[$\\]/);
  });

  it("sets one-line dollar math alone in a paragraph as a display equation", async () => {
    await render("Solve:\n\n$$x = 1$$\n\nHere $$y$$ stays inline.\n");

    expect(equations()).toHaveLength(2);
    expect(container.querySelectorAll(".katex-display")).toHaveLength(1);
  });

  it("leaves prose and code that look like math alone", async () => {
    await render(
      [
        "It costs $5 and $10.",
        "",
        tex`See \[1\], or an unclosed \( here.`,
        "",
        "Write `$x$` or `\\(x\\)`.",
        "",
        "```\n$$\ny\n$$\n```",
      ].join("\n"),
    );

    expect(equations()).toEqual([]);
    expect(container.textContent).toContain("It costs $5 and $10.");
    expect(container.textContent).toContain("See [1], or an unclosed ( here.");
    expect(container.querySelector("p code")?.textContent).toBe("$x$");
  });

  it("typesets math inside tables, lists, quotes and headings", async () => {
    await render(
      [
        tex`# Energy $E$`,
        "",
        "| Symbol | Meaning |",
        "| --- | --- |",
        tex`| \(m\) | mass |`,
        "",
        "- Speed $c$",
        "",
        "> Solve:",
        "> \\[",
        "> x = 1",
        "> \\]",
      ].join("\n"),
    );

    expect(failures()).toEqual([]);

    for (const selector of ["h1", "td", "li", "blockquote"])
      expect(container.querySelector(`${selector} .katex`)).not.toBeNull();
  });

  it("typesets math in agent messages", async () => {
    await act(async () =>
      root.render(<AgentMarkdown source={tex`The root is \(\sqrt{2}\).`} />),
    );

    expect(failures()).toEqual([]);
    expect(equations()).toHaveLength(1);
  });

  it("typesets the new source when a message changes", async () => {
    await render("$a + b$");
    await render("$a + b + c$");

    expect(equations()).toHaveLength(1);
    expect(container.querySelector("annotation")?.textContent).toBe(
      "a + b + c",
    );
  });

  it("names an unknown command and typesets the rest", async () => {
    await render(display(tex`\cancelto{0}{x} + \frac{a}{b}`));

    expect(failures()).toEqual([]);
    expect(container.querySelector(".katex-html")?.textContent).toContain(
      tex`\cancelto`,
    );
    expect(container.querySelector(".katex .mfrac")).not.toBeNull();
  });

  it.each([
    ["an unknown environment", tex`\begin{multline} a \\ b \end{multline}`],
    ["unbalanced braces", tex`\frac{a}{b`],
    ["a runaway macro", tex`\def\a{\a\a}\a`],
  ])("shows the source of %s and keeps the document", async (_, source) => {
    await render(`Before.\n\n${display(source)}\nAfter $x$.\n`);

    expect(failures()).toEqual([source]);
    expect(container.textContent).toContain("Before.");
    expect(container.querySelector("p:last-of-type .katex")).not.toBeNull();
  });

  it.each([
    ["a script link", tex`\href{javascript:alert(1)}{x}`],
    [
      "a web link",
      tex`\href{https://example.com}{x} \url{https://example.com}`,
    ],
    ["an image", tex`\includegraphics{https://example.com/a.png}`],
    [
      "attributes",
      tex`\htmlId{top}{a} \htmlClass{review-canvas-root}{b} \htmlStyle{position: fixed}{c} \htmlData{review-api=1}{d}`,
    ],
  ])("renders %s from math as inert text", async (_, source) => {
    await render(display(source));

    expect(equations().length + failures().length).toBeGreaterThan(0);
    expect(
      container.querySelector(
        "a, img, #top, .review-canvas-root, [data-review-api], [style*=fixed]",
      ),
    ).toBeNull();
  });

  it("scrolls a wide equation inside the document", async () => {
    container.style.width = "240px";

    await render(
      display(Array.from({ length: 40 }, (_, i) => `x_{${i}}`).join(" + ")),
    );

    const equation = container.querySelector<HTMLElement>(
      "span:has(> .katex-display)",
    )!;

    expect(equation.scrollWidth).toBeGreaterThan(equation.clientWidth);
    expect(container.scrollWidth).toBe(container.clientWidth);
    expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
  });

  it("draws glyphs in the math fonts", async () => {
    await render(display(tex`\mathbb{R} \ni x = \sum_i \mathcal{L}_i`));
    await document.fonts.ready;

    const loaded = document.fonts
      .values()
      .filter((font) => font.status === "loaded")
      .map((font) => font.family.replaceAll('"', ""))
      .toArray();

    expect(loaded).toEqual(
      expect.arrayContaining([
        "KaTeX_Main",
        "KaTeX_Math",
        "KaTeX_AMS",
        "KaTeX_Caligraphic",
        "KaTeX_Size1",
      ]),
    );
  });
});
