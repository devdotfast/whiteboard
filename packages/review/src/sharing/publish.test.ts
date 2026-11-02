import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createShareSchema } from "@dev.fast/review-share-protocol";
import { readStoreAuth, writeStoreAuth } from "@dev.fast/trace-core";
import { ReviewInputError } from "@dev.fast/whiteboard-document";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { mountSharingHost } from "./host.js";

it.each(["dev-fast-review", "dev-fast-review-preview"])(
  "posts one bundle naming the repository (%s)",
  async (protocol) => {
    const root = await mkdtemp(path.join(tmpdir(), "sharing-publish-"));
    const fixture = await createShareFixture(root);
    vi.stubEnv("DEV_REVIEW_HOME", root);
    vi.stubEnv("DEV_FAST_REVIEW_APP_URL_PROTOCOL", protocol);
    const shareId = randomUUID();
    const requests: string[] = [];
    const published: unknown[] = [];
    let uploaded: unknown;

    try {
      await writeStoreAuth({
        origin: "https://app.dev.fast",
        token: "fixture",
        login: "fixture",
        savedAt: new Date().toISOString(),
      });
      const api = new Hono();
      api.onError((error, context) =>
        context.json(
          { error: error.message },
          error instanceof ReviewInputError ? error.status : 500,
        ),
      );
      mountSharingHost(api, fixture.store, fixture.data, {
        readRepository: async () => fixture.repository,
        onPublished: (event) => published.push(event),
        fetch: async (input, init) => {
          const url = new URL(String(input));

          if (url.pathname === "/api/auth/token")
            return new Response(null, { status: 404 });
          requests.push(`${init?.method} ${url.pathname}`);

          uploaded = JSON.parse(String(init?.body));

          return Response.json({
            shareId,
            url: `https://app.dev.fast/s/${"x".repeat(43)}`,
          });
        },
      });

      const response = await api.request("/sharing/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewId: fixture.reviewId }),
      });

      const version = fixture.store.read(fixture.reviewId).version;
      expect(await response.json()).toEqual({
        shareId,
        url: `https://app.dev.fast/s/${"x".repeat(43)}${protocol === "dev-fast-review-preview" ? "?app=preview" : ""}`,
        version,
      });
      expect(published).toEqual([{ reviewId: fixture.reviewId, version }]);
      expect(requests).toEqual(["POST /api/v2/shares"]);
      expect(createShareSchema.parse(uploaded).bundle.repository).toEqual(
        fixture.repository,
      );
    } finally {
      vi.unstubAllEnvs();
      await fixture.data.close();
      await fixture.store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each([
  {
    send: async () => new Response(null, { status: 426 }),
    error:
      "This action requires a newer version of Whiteboard. Use Check for Updates, then try again.",
  },
  {
    send: async () => {
      throw new TypeError("fetch failed");
    },
    error:
      "Could not reach the sharing service. Check your connection, then retry.",
  },
  {
    send: async () => {
      throw new DOMException("private response details", "TimeoutError");
    },
    error: "The sharing request timed out. Please retry.",
  },
  {
    send: async () => Response.json({ unexpected: "private response details" }),
    error:
      "The sharing service returned an unexpected response. Update Whiteboard or report this issue.",
  },
])(
  "preserves the login and explains a failed publish: $error",
  async ({ send, error }) => {
    const root = await mkdtemp(path.join(tmpdir(), "sharing-publish-"));
    const fixture = await createShareFixture(root);
    vi.stubEnv("DEV_REVIEW_HOME", root);

    try {
      const auth = {
        origin: "https://app.dev.fast",
        token: randomUUID(),
        login: "fixture",
        savedAt: new Date().toISOString(),
      };

      await writeStoreAuth(auth);
      const api = new Hono();
      api.onError((failure, context) =>
        context.json(
          { error: failure.message },
          failure instanceof ReviewInputError ? failure.status : 500,
        ),
      );
      mountSharingHost(api, fixture.store, fixture.data, {
        readRepository: async () => fixture.repository,
        fetch: async (input) =>
          String(input).endsWith("/api/auth/token")
            ? new Response(null, { status: 404 })
            : send(),
      });

      const response = await api.request("/sharing/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewId: fixture.reviewId }),
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error });
      expect(await readStoreAuth()).toEqual(auth);
    } finally {
      vi.unstubAllEnvs();
      await fixture.data.close();
      await fixture.store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("signs the user out when the share service rejects the stored token", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sharing-publish-"));
  const fixture = await createShareFixture(root);
  vi.stubEnv("DEV_REVIEW_HOME", root);

  try {
    await writeStoreAuth({
      origin: "https://app.dev.fast",
      token: "expired",
      login: "fixture",
      savedAt: new Date().toISOString(),
    });
    const api = new Hono();
    api.onError((error, context) =>
      context.json(
        { error: error.message },
        error instanceof ReviewInputError ? error.status : 500,
      ),
    );
    mountSharingHost(api, fixture.store, fixture.data, {
      readRepository: async () => fixture.repository,
      fetch: async () => new Response("unauthorized", { status: 401 }),
    });

    const response = await api.request("/sharing/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewId: fixture.reviewId }),
    });

    expect(await response.json()).toEqual({
      error: "Your sign-in has expired. Sign in again to share.",
    });
    expect(response.status).toBe(401);
    expect(await readStoreAuth()).toBeNull();
  } finally {
    vi.unstubAllEnvs();
    await fixture.data.close();
    await fixture.store.close();
    await rm(root, { recursive: true, force: true });
  }
});
