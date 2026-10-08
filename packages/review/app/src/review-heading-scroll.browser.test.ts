import { afterEach, expect, it } from "vitest";

import { scrollToReviewBlock } from "./review-heading-scroll";

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
