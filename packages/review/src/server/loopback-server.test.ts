import { once } from "node:events";
import { readFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { connect as h2Connect } from "node:http2";
import type { AddressInfo } from "node:net";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { afterEach, describe, expect, it } from "vitest";

import { type ReviewHonoEnv, createNodeRequestListener } from "./hono-http";
import { type LoopbackServer, createLoopbackServer } from "./loopback-server";

const fixture = new URL("../../test/fixtures/loopback-tls/", import.meta.url);

const tls = {
  key: readFileSync(new URL("key.pem", fixture), "utf8"),
  cert: readFileSync(new URL("cert.pem", fixture), "utf8"),
};

const app = new Hono<ReviewHonoEnv>();

app.get("/version", (context) =>
  context.text(context.env.incoming.httpVersion),
);

app.get("/events", (context) =>
  streamSSE(context, async (stream) => {
    await stream.writeSSE({ data: "first" });
    await new Promise<void>((resolve) => stream.onAbort(resolve));
  }),
);

const large = "x".repeat(4 * 1024 * 1024);

app.get("/large", (context) => context.text(large));

let running: LoopbackServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(withTls = true) {
  running = createLoopbackServer(
    createNodeRequestListener(app),
    withTls ? tls : undefined,
  );
  running.server.listen(0, "127.0.0.1");
  await once(running.server, "listening");

  return (running.server.address() as AddressInfo).port;
}

function read(response: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";

    response.setEncoding("utf8");
    response.on("data", (chunk: string) => (body += chunk));
    response.on("end", () => resolve(body));
    response.on("error", reject);
  });
}

describe("createLoopbackServer", () => {
  it.each([true, false])("serves plain HTTP/1.1 (tls %s)", async (withTls) => {
    const port = await start(withTls);

    const response = await new Promise<NodeJS.ReadableStream>((resolve) =>
      httpGet({ port, host: "127.0.0.1", path: "/version" }, resolve),
    );

    await expect(read(response)).resolves.toBe("1.1");
  });

  it("serves h2 and streams SSE without connection-specific headers", async () => {
    const port = await start();
    const session = h2Connect(`https://127.0.0.1:${port}`, { ca: tls.cert });

    try {
      const version = session.request({ ":path": "/version" });

      await expect(read(version)).resolves.toBe("2.0");

      const events = session.request({ ":path": "/events" });
      const [headers] = await once(events, "response");

      expect(headers[":status"]).toBe(200);
      expect(headers["transfer-encoding"]).toBeUndefined();
      expect(headers["content-type"]).toContain("text/event-stream");

      events.setEncoding("utf8");
      const [first] = await once(events, "data");

      expect(first).toContain("data: first");
      events.close();
    } finally {
      session.close();
    }
  });

  it("streams many large h2 responses at once", async () => {
    const port = await start();
    const session = h2Connect(`https://127.0.0.1:${port}`, { ca: tls.cert });

    try {
      const sizes = await Promise.all(
        Array.from(
          { length: 12 },
          async () =>
            (await read(session.request({ ":path": "/large" }))).length,
        ),
      );

      expect(sizes).toEqual(Array(12).fill(large.length));
    } finally {
      session.close();
    }
  });

  it("ends a live h2 stream within the close grace period", async () => {
    const port = await start();
    const session = h2Connect(`https://127.0.0.1:${port}`, { ca: tls.cert });

    session.on("error", () => undefined);

    const events = session.request({ ":path": "/events" });

    events.on("error", () => undefined);
    await once(events, "response");

    const started = Date.now();

    await running?.close();
    running = undefined;

    expect(Date.now() - started).toBeLessThan(3_000);
    session.destroy();
  });
});
