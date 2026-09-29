import * as stylex from "@stylexjs/stylex";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { scopeReviewCanvasCss } from "../desktop-css-scope";
import { MarkdownContent } from "./agent-markdown";
import { documentStyles } from "./document-styles";
import { appMarker, documentMarker, proseMarker } from "./markers.stylex";
import {
  softwareMapFrameProps,
  softwareMapOverlayProps,
} from "./software-map/SoftwareMap";
import { TraceQuote } from "./trace-quote";

import canvasCss from "./styles.css?inline";
import "./styles.css";

describe("Review layout", () => {
  it("aligns standalone JSON trace quotes with prose while keeping nested quotes inline", () => {
    const quote = (text: string) =>
      createElement(TraceQuote, { sessionId: "session" }, text);

    const documentView = document.createElement("article");
    documentView.className = `review-document ${stylex.props(documentStyles.article, documentMarker).className}`;
    documentView.style.width = "1000px";
    documentView.innerHTML = `
      <div class="${stylex.props(proseMarker).className}" data-review-node-id="node">
        ${renderToStaticMarkup(
          createElement(MarkdownContent, {
            source: "Prose with [an inline quote](#quote).",
            renderLink: (_href, children) => quote(String(children)),
          }),
        )}
      </div>
      <div class="${stylex.props(proseMarker).className}" data-review-node-id="node">
        ${renderToStaticMarkup(quote("A standalone quote"))}
      </div>
    `;
    document.body.append(documentView);

    try {
      const prose = documentView.querySelector("p")!;
      const inline = prose.querySelector("span")!;

      const standalone = documentView.querySelector<HTMLElement>(
        "[data-review-node-id] > span",
      )!;

      const proseBounds = prose.getBoundingClientRect();
      const quoteBounds = standalone.getBoundingClientRect();
      expect(quoteBounds.left).toBeCloseTo(proseBounds.left);
      expect(quoteBounds.width).toBeCloseTo(proseBounds.width);
      expect(getComputedStyle(inline).display).toBe("inline");
    } finally {
      documentView.remove();
    }
  });

  it("keeps an expanded software map inside the viewport and above the topbar", () => {
    const styles = document.createElement("style");
    styles.textContent = scopeReviewCanvasCss(canvasCss);
    const canvas = document.createElement("div");
    canvas.className = "review-canvas-root";
    canvas.style.cssText =
      "position: fixed; inset: 40px 0 0; height: auto; min-height: 0";
    const review = document.createElement("div");
    review.className = `review-app ${stylex.props(appMarker).className}`;
    canvas.append(review);
    const frame = document.createElement("figure");
    frame.className = softwareMapFrameProps({
      expanded: true,
      showChrome: true,
    }).className!;
    const overlay = document.createElement("div");
    overlay.className = softwareMapOverlayProps({
      theme: "dark",
      nodeTint: "slate",
    }).className!;
    const closeButton = document.createElement("button");
    closeButton.setAttribute("aria-label", "Close expanded software map");
    overlay.append(closeButton, frame);
    canvas.append(overlay);
    document.body.append(styles, canvas);

    const overlayStyle = getComputedStyle(overlay);
    const frameStyle = getComputedStyle(frame);

    expect(frameStyle.marginBlockStart).toBe("0px");
    expect(frameStyle.marginBlockEnd).toBe("0px");
    expect(overlayStyle.position).toBe("fixed");
    const bounds = overlay.getBoundingClientRect();
    expect(bounds.top).toBe(40);
    expect(bounds.bottom).toBe(window.innerHeight);
    expect(bounds.width).toBe(window.innerWidth);
    expect(overlay.contains(document.elementFromPoint(100, 100))).toBe(true);
    expect(Number(overlayStyle.zIndex)).toBeGreaterThan(2_147_482_999);
    expect(
      overlay.querySelector('[aria-label="Close expanded software map"]'),
    ).toBe(closeButton);
  });
});
