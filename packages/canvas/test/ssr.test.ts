import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";

import { shareFixture } from "../../review/app/src/share/share-fixture";
import { Whiteboard, WhiteboardProvider, openShare } from "../dist/index.js";

type Canvas = typeof import("../dist/index.js");

const renderShare = async (
  { Whiteboard, WhiteboardProvider, openShare }: Canvas,
  wasmUrl?: string,
) => {
  const view = await openShare(shareFixture, { theme: "system", wasmUrl });

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

  view.dispose();

  return html;
};

it("renders a share on a server, leaving its diagram to the client", async () => {
  expect(globalThis).not.toHaveProperty("document");

  const html = await renderShare({ Whiteboard, WhiteboardProvider, openShare });

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
});

it("imports and renders where import.meta.url is undefined, as in a Worker", async () => {
  // Inside node_modules, so the copy still resolves react.
  const dist = mkdtempSync(
    path.join(import.meta.dirname, "../node_modules/.worker-dist-"),
  );

  try {
    cpSync(path.join(import.meta.dirname, "../dist"), dist, {
      recursive: true,
    });

    for (const file of readdirSync(dist, { recursive: true })) {
      const target = path.join(dist, String(file));

      if (target.endsWith(".js"))
        writeFileSync(
          target,
          readFileSync(target, "utf8").replaceAll(
            "import.meta.url",
            "undefined",
          ),
        );
    }

    const canvas: Canvas = await import(
      /* @vite-ignore */ pathToFileURL(path.join(dist, "index.js")).href
    );

    // A server has no wasm to route diagrams with; cloudboard passes this.
    expect(await renderShare(canvas, "about:blank")).toContain(
      "Orders now queue.",
    );
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
