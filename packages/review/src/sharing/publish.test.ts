import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createShareSchema } from "@dev.fast/review-share-protocol";
import { readStoreAuth, writeStoreAuth } from "@dev.fast/trace-core";
import { ReviewInputError } from "@review/review-api/document.js";
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
