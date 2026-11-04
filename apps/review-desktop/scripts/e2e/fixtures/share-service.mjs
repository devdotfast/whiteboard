/** A share service for journeys: one link per board, a revision per newer version. */
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";

export async function startShareService({ tls } = {}) {
  const posts = [];
  // Board id to { shareId, capability, revisions: [{ id, version, size, createdAt, bundle }] }, newest revision first.
  const links = new Map();

  const server = tls
    ? createSecureServer(
        tls,
        (request, response) => void handle(request, response),
      )
    : createServer((request, response) => void handle(request, response));

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();

  const origin = `${tls ? "https" : "http"}://localhost:${server.address().port}`;

  const linkUrl = (link, rev) =>
    `${origin}/s/${link.capability}${rev ? `?rev=${rev}` : ""}`;

  function publish(reviewId, bundle) {
    let link = links.get(reviewId);

    if (!link) {
      link = {
        shareId: randomUUID(),
        capability: randomBytes(32).toString("base64url"),
        revisions: [],
      };
      links.set(reviewId, link);
    }

    if (!link.revisions.length || bundle.version > link.revisions[0].version)
      link.revisions.unshift({
        id: randomUUID(),
        version: bundle.version,
        size: Buffer.byteLength(JSON.stringify(bundle)),
        createdAt: Date.now(),
        bundle,
      });

    return { shareId: link.shareId, url: linkUrl(link) };
  }

  const byShareId = (id) =>
    [...links.values()].find((link) => link.shareId === id);

  const byCapability = (cap) =>
    [...links.values()].find((link) => link.capability === cap);

  async function handle(request, response) {
    const url = new URL(request.url, origin);

    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body ?? { error: "not found" }));
    };

    let body = "";

    for await (const chunk of request) body += chunk;

    const parts = url.pathname.split("/").slice(1);
    const route = `${request.method} /${parts.slice(0, 3).join("/")}`;

    if (route === "GET /api/auth/token") return send(404);

    if (url.pathname === "/api/v2/shares" && request.method === "GET")
      return send(200, []);

    if (url.pathname === "/api/v2/shares" && request.method === "POST") {
      const input = JSON.parse(body);

      posts.push(input);

      return send(200, publish(input.bundle.reviewId, input.bundle));
    }

    if (route === "GET /api/v2/shares" && parts[4] === "revisions") {
      const link = byShareId(parts[3]);

      return link
        ? send(200, {
            latest: link.revisions[0].id,
            items: link.revisions.map(({ bundle: _, ...revision }) => ({
              ...revision,
              url: linkUrl(link, revision.id),
            })),
          })
        : send(404);
    }

    if (route === "DELETE /api/v2/shares") {
      const link = byShareId(parts[3]);

      if (!link) return send(404);

      for (const [key, value] of links) if (value === link) links.delete(key);

      return send(200, { shareId: link.shareId, revoked: true });
    }

    if (route === "GET /api/v2/shared") {
      const link = byCapability(parts[3]);
      const rev = url.searchParams.get("rev");

      const revision = rev
        ? link?.revisions.find((candidate) => candidate.id === rev)
        : link?.revisions[0];

      if (!revision) return send(404);

      if (parts[4] === "bundle") return send(200, revision.bundle);

      return send(200, {
        sender: { login: "e2e" },
        sharedAt: revision.createdAt,
        size: revision.size,
        revision: {
          id: revision.id,
          version: revision.version,
          createdAt: revision.createdAt,
        },
        latest: link.revisions[0].id,
      });
    }

    send(404);
  }

  return {
    origin,
    posts,
    links,
    publish,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
