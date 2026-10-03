import type {
  ReviewCanvasBridge,
  ReviewDiagramCapturePage,
} from "@dev.fast/review-protocol";

import { prepareDiagramCapture } from "./diagram-capture";

/** Snapshot markup and authored CSS without attaching anything to the live page. */
export async function captureDiagramInHiddenPage(
  figure: HTMLElement,
  capture: NonNullable<ReviewCanvasBridge["capturePageImage"]>,
): Promise<void> {
  const document = figure.ownerDocument;
  const { panel, width, height, background } = prepareDiagramCapture(figure);

  // Keep the ancestor selectors, theme classes, and inline CSS variables, but
  // none of their siblings. In particular @scope needs .review-canvas-root.
  let root: HTMLElement = panel;

  for (
    let parent = figure.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    // SAFETY: A shallow clone of an HTMLElement preserves its element type.
    const shell = parent.cloneNode(false) as HTMLElement;
    shell.setAttribute("data-diagram-capture-context", "");
    shell.appendChild(root);
    root = shell;
  }

  const styles: ReviewDiagramCapturePage["styles"] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.disabled) continue;

    if (sheet.href) {
      styles.push({ href: sheet.href });
    } else {
      styles.push({
        css: Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n"),
      });
    }
  }

  for (const sheet of document.adoptedStyleSheets) {
    styles.push({
      css: Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n"),
    });
  }

  await capture({ html: root.outerHTML, styles, width, height, background });
}
