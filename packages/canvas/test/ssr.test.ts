import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";

import { shareFixture } from "../../review/app/src/share/share-fixture";
import { Whiteboard, WhiteboardProvider, openShare } from "../dist/index.js";

it("renders a share on a server, leaving its diagram to the client", async () => {
  expect(globalThis).not.toHaveProperty("document");

  const view = await openShare(shareFixture, { theme: "system" });

  const html = renderToString(
    createElement(
      "div",
      { className: "review-canvas-root" },
      createElement(
        WhiteboardProvider,
        { data: view.data, host: view.host, settings: {} },
        createElement(Whiteboard),
      ),
    ),
  );

  for (const text of [
    "Orders now queue.",
    "Queueing",
    "Careful",
    "Sent only once.",
    "Queue it first",
    // Escaped: excerpts are untrusted.
    "&#34;&#60;queued&#62;&#34;",
    "// sent once written",
  ])
    expect(html).toContain(text);

  expect(html).not.toContain("<queued>");
  // Images are not shared yet; the block keeps its place and its alt text.
  expect(html).toContain('alt="The queue"');
  expect(html).not.toContain("src=");
  expect(html).toContain('data-diagram-placeholder="FLOW"');
  expect(html).not.toContain("Write order");
  expect(html).toContain('data-diagram-placeholder="ANIMATION"');
  expect(html).not.toContain("<iframe");
  view.dispose();
});
