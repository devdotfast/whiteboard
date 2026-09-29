import { describe, expect, it } from "vitest";

import { prepareDiagramCapture } from "./diagram-capture";

function diagram(width: number, height: number) {
  const figure = document.createElement("figure");
  const tree = document.createElement("nav");
  tree.setAttribute("aria-label", "Call tree");
  tree.style.cssText = `display:block;box-sizing:border-box;width:${width}px;height:${height}px;min-width:0;min-height:0;max-width:none;max-height:none;margin:0;padding:0;border:0`;
  tree.textContent = "First call → last call";
  figure.append(tree);
  document.body.append(figure);

  return figure;
}

describe("diagram capture sizing", () => {
  it("preserves natural size even when the diagram exceeds the visible window", () => {
    const figure = diagram(1800, 1200);
    const before = figure.outerHTML;
    const capture = prepareDiagramCapture(figure);

    expect(capture.width).toBe(1856);
    expect(capture.height).toBe(1256);
    expect(capture.panel.textContent).toContain("First call → last call");
    expect(capture.panel.isConnected).toBe(false);
    expect(figure.outerHTML).toBe(before);
  });

  it.each([
    [4000, 1000, 2048, 554],
    [1000, 4000, 554, 2048],
    [4000, 4000, 2048, 2048],
  ])(
    "fits a %i × %i diagram without changing its proportions",
    (width, height, expectedWidth, expectedHeight) => {
      const capture = prepareDiagramCapture(diagram(width, height));

      expect(capture.width).toBe(expectedWidth);
      expect(capture.height).toBe(expectedHeight);

      const tree = capture.panel.querySelector<HTMLElement>(
        'nav[aria-label="Call tree"]',
      )!;

      const transform = new DOMMatrixReadOnly(tree.style.transform);
      expect(transform.a).toBe(transform.d);
      expect(transform.a * width + 56).toBeCloseTo(expectedWidth);
      expect(transform.d * height + 56).toBeCloseTo(expectedHeight);
    },
  );
});
