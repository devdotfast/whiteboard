import * as stylex from "@stylexjs/stylex";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { documentStyles } from "./document-styles";
import { type ReviewRoots, ReviewRootsProvider } from "./review-root-context";
import { ReviewToc } from "./review-toc";
import { shellStyles } from "./shell-styles";

import "./styles.css";

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];

// The rail width effect only needs ResizeObserver to exist in these tests.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver as never;

function renderArticle(headings: string[]): HTMLElement {
  const article = document.createElement("article");
  article.className = `review-document ${stylex.props(documentStyles.article).className}`;
  article.innerHTML = headings
    .map(
      (heading, index) =>
        `<h2 id="heading-${index}">${heading}</h2><p>body</p>`,
    )
    .join("");

  return article;
}

function tocLabels(): string[] {
  // Entries render with their section number prefixed; compare the titles.
  return [...document.querySelectorAll("#review-toc li > button")].map((link) =>
    (link.textContent ?? "").trim().replace(/^[\d.]+/, ""),
  );
}

describe("ReviewToc", () => {
  let shell: HTMLElement;
  let region: HTMLElement;
  let view: HTMLElement;
  let mount: HTMLElement;
  let reviewRoots: ReviewRoots;

  beforeEach(() => {
    document.body.innerHTML = "";
    shell = document.createElement("main");
    shell.className = stylex.props(shellStyles.documentShell).className!;
    region = document.createElement("div");
    region.className = `review-view-region--review ${stylex.props(shellStyles.reviewRegion).className}`;
    view = document.createElement("div");
    view.className = `review-document-view ${stylex.props(shellStyles.documentView).className}`;
    mount = document.createElement("div");
    view.append(mount);
    region.append(view);
    shell.append(region);
    document.body.append(shell);
    const app = document.createElement("div");
    reviewRoots = {
      appRef: { current: app },
      shellRef: { current: shell },
      scrollRegionRef: { current: region },
      articleRef: createRef<HTMLElement>(),
    };
  });

  afterEach(() => {
    act(() => {
      for (const root of mountedRoots.splice(0)) root.unmount();
    });
    document.body.innerHTML = "";
  });

  it("renders supplied navigation entries with section numbers", () => {
    const firstArticle = renderArticle([
      "Interface change",
      "Scheduling sequence",
    ]);

    reviewRoots.articleRef.current = firstArticle;
    view.append(firstArticle);
    const root = createRoot(mount);
    mountedRoots.push(root);
    act(() => {
      root.render(
        <ReviewRootsProvider roots={reviewRoots}>
          <ReviewToc
            entries={[
              { id: "heading-0", text: "Interface change", level: "h2" },
              { id: "heading-1", text: "Scheduling sequence", level: "h2" },
            ]}
          />
        </ReviewRootsProvider>,
      );
    });
    expect(tocLabels()).toEqual(["Interface change", "Scheduling sequence"]);
    expect(
      document
        .querySelector("#review-toc li > button > span")
        ?.textContent?.trim(),
    ).toBe("1");
    expect(
      document.querySelector('[aria-controls="review-toc-body"]')?.textContent,
    ).not.toContain("§");
  });
  it.each([
    { from: 1400, to: 1200, rail: false },
    { from: 1200, to: 1400, rail: true },
  ])(
    "switches between rail and pill without animating when the shell goes from $from to $to wide",
    async ({ from, to, rail }) => {
      shell.style.width = `${from}px`;
      const article = renderArticle(["Interface change", "Scheduling"]);
      region.append(article);
      reviewRoots.articleRef.current = article;
      const root = createRoot(mount);
      mountedRoots.push(root);

      await act(async () =>
        root.render(
          <ReviewRootsProvider roots={reviewRoots}>
            <ReviewToc
              entries={[
                { id: "heading-0", level: "h2", text: "Interface change" },
                { id: "heading-1", level: "h2", text: "Scheduling" },
              ]}
            />
          </ReviewRootsProvider>,
        ),
      );

      const settle = () =>
        act(
          async () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );

      await settle();
      shell.style.width = `${to}px`;
      await settle();

      const toc = document.querySelector("#review-toc")!;

      // The rail has no toggle; the pill's starts shut.
      const toggle = toc.querySelector<HTMLButtonElement>(
        '[aria-controls="review-toc-body"]',
      )!;

      expect(toggle.hidden).toBe(rail);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(toc.getAnimations({ subtree: true })).toEqual([]);
    },
  );
});
