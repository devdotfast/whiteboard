import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import {
  scrollToReviewBlock,
  scrollToReviewHeading,
  useHeadingInView,
} from "./review-heading-scroll";

afterEach(() => document.body.replaceChildren());

it("waits to scroll to a block until its document shows", () => {
  const region = document.createElement("div");
  region.style.cssText = "height: 100px; overflow: auto";
  const article = document.createElement("article");
  article.innerHTML =
    '<div style="height: 500px"></div><p data-review-node-id="block-2">Here</p>';
  region.append(article);
  document.body.append(region);

  // The Diff view hides the document.
  article.hidden = true;
  expect(scrollToReviewBlock("block-2", article, region)).toBe(false);
  expect(region.scrollTop).toBe(0);

  article.hidden = false;
  expect(scrollToReviewBlock("block-2", article, region)).toBe(true);
  expect(region.scrollTop).toBeGreaterThan(0);
});

it("waits to scroll to a heading until its document shows", () => {
  const region = document.createElement("div");
  region.style.cssText = "height: 100px; overflow: auto";
  const article = document.createElement("article");
  article.innerHTML = '<div style="height: 500px"></div><h2 id="api">API</h2>';
  region.append(article);
  document.body.append(region);

  article.hidden = true;
  expect(scrollToReviewHeading("api", article, region)).toBe(false);

  article.hidden = false;
  expect(scrollToReviewHeading("api", article, region)).toBe(true);
  expect(region.scrollTop).toBeGreaterThan(0);
});

it("gives the last heading room to scroll to the top", async () => {
  const region = document.createElement("div");
  region.style.cssText =
    "box-sizing: border-box; height: 300px; overflow: auto; padding-bottom: var(--review-toc-tail, 0px)";
  const article = document.createElement("article");
  article.innerHTML =
    '<h2 id="first">First</h2><div style="height: 600px"></div><h2 id="last">Last</h2><p>End.</p>';
  region.append(article);
  document.body.append(region);

  const entries = [{ id: "first" }, { id: "last" }];

  function Page() {
    useHeadingInView(entries, { current: article }, { current: region }, true);

    return null;
  }

  const root = createRoot(document.createElement("div"));

  await act(async () => root.render(createElement(Page)));
  scrollToReviewHeading("last", article, region);

  const heading = article.querySelector("#last")!;

  expect(
    heading.getBoundingClientRect().top - region.getBoundingClientRect().top,
  ).toBeLessThan(30);

  act(() => root.unmount());
});
