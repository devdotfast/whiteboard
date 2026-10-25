/** A renderer that cannot complete https, here through a wrong pinned cert, falls back to plain HTTP and says so. */
import assert from "node:assert/strict";

import { createReview } from "../harness.mjs";

export const name = "loopback-fallback";

export const phase = 1;

export const options = {
  env: {
    DEV_FAST_REVIEW_TLS_PIN_MISMATCH: "1",
    DEV_FAST_REVIEW_TELEMETRY_DISABLED: "",
    DEV_FAST_REVIEW_TELEMETRY_DEBUG: "1",
  },
};

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
    title: "Loopback fallback e2e",
    blocks: [{ type: "markdown", markdown: "Served over http/1.1." }],
  });

  await canvas.getByText("Served over http/1.1.").waitFor();
  await cdp.detach();

  assert.deepEqual([...protocols], ["http:http/1.1"]);

  const fallback = await ctx.until(
    () =>
      ctx
        .appLog()
        .split("\n")
        .find((line) => line.includes('"review_loopback_tls_fallback"')),
    "the fallback telemetry event",
  );

  assert.match(fallback, /"error_name":"TypeError"/);
}
