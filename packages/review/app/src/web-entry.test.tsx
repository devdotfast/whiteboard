import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";

import { share } from "./shared-board-test-utils";
import { Whiteboard } from "./web-entry";

// A page that renders on a server, as review-web does in Workers, imports and
// renders the component there; the board itself mounts in the browser.
it("renders on a server without a DOM", async () => {
  expect("window" in globalThis).toBe(false);

  const html = renderToString(
    <Whiteboard
      share={await share("three-minute-tour")}
      wasmUrl="/libavoid.wasm"
    />,
  );

  expect(html).toContain('class="review-canvas-root"');
});
