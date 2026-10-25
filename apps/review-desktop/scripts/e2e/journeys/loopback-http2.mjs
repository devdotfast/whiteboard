/** The renderer reaches the server over HTTP/2 on its loopback port; plain HTTP on the same port keeps serving the CLI. */
import assert from "node:assert/strict";

import { createReview } from "../harness.mjs";

export const name = "loopback-http2";

export const phase = 1;

export const options = {};

export async function run(ctx) {
  const { port } = new URL(ctx.discovery.url);
  const cdp = await ctx.page.context().newCDPSession(ctx.page);
  const protocols = new Set();

  cdp.on("Network.responseReceived", ({ response }) => {
    const url = new URL(response.url);

    if (url.hostname === "127.0.0.1" && url.port === port)
      protocols.add(`${url.protocol}${response.protocol}`);
  });
  await cdp.send("Network.enable");

  const { canvas } = await createReview(ctx, {
    title: "Loopback HTTP/2 e2e",
    blocks: [{ type: "markdown", markdown: "Served over h2." }],
  });

  await canvas.getByText("Served over h2.").waitFor();
  await cdp.detach();

  assert.deepEqual([...protocols], ["https:h2"]);
  assert.equal((await fetch(`${ctx.discovery.url}/health`)).status, 200);
}
