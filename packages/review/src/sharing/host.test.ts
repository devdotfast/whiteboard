import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type openUrlInBrowser,
  readStoreAuth,
  type runStoreLogin,
  writeStoreAuth,
} from "@dev.fast/trace-core";
import { ReviewInputError } from "@dev.fast/whiteboard-document";
import type { SharedProvenance } from "@review/review-api/store.js";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { ShareClient } from "./client.js";
import { exportShare } from "./export.js";
import { mountSharingHost } from "./host.js";
import { shareKey } from "./import.js";
import { fetchPinnedRepository } from "./repository.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const R = randomUUID();

const capability = "a".repeat(43);

const url = `https://app.dev.fast/s/${capability}`;

const meta = {
  sender: { login: "sender" },
  sharedAt: 1,
  size: 1,
  revision: { id: R, version: 1, createdAt: 1 },
  latest: R,
};

it("exposes the device URL and code while login is pending and allows retry after failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "share-login-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  const fixture = await createShareFixture(root);
  const api = new Hono();
  const login = vi.fn<typeof runStoreLogin>();
  const openUrl = vi.fn<typeof openUrlInBrowser>(async () => {});
  mountSharingHost(api, fixture.store, fixture.data, { login, openUrl });
  let finish!: (code: number) => void;
  login.mockImplementation(async (options) => {
    options!.onDeviceCode!({
      url: "https://app.dev.fast/device?user_code=ABCD",
      userCode: "ABCD",
    });
    await options!.openUrl!("https://app.dev.fast/device?user_code=ABCD");

    return new Promise<number>((resolve) => {
      finish = resolve;
    });
  });

  try {
    await api.request("/sharing/login", { method: "POST" });
    await vi.waitFor(async () => {
      expect(
        await (await api.request("/sharing/account")).json(),
      ).toMatchObject({
        pending: true,
        url: "https://app.dev.fast/device?user_code=ABCD",
        userCode: "ABCD",
      });
    });
    await api.request("/sharing/login", { method: "POST" });
    expect(login).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(
      "https://app.dev.fast/device?user_code=ABCD",
    );
    finish(1);
    await vi.waitFor(async () =>
      expect(
        await (await api.request("/sharing/account")).json(),
      ).toMatchObject({
        pending: false,
        error: "Sign-in did not finish. Try again.",
      }),
    );
    login.mockResolvedValue(0);
    await api.request("/sharing/login", { method: "POST" });
    await vi.waitFor(async () =>
      expect(await (await api.request("/sharing/account")).json()).toEqual({
        account: null,
        pending: false,
      }),
    );
  } finally {
    await fixture.data.close();
    fixture.store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("reports download and checkout preparation, and opens the same copy when the link is opened again", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "share-progress-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  const fixture = await createShareFixture(root);
  const bundle = await exportShare(fixture);

  let download!: (
    received: Awaited<ReturnType<ShareClient["download"]>>,
  ) => void;

  const downloadSpy = vi
    .spyOn(ShareClient.prototype, "download")
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          download = resolve;
        }),
    );

  const sharedSpy = vi
    .spyOn(ShareClient.prototype, "shared")
    .mockResolvedValue(meta);

  let fetched!: () => void;

  const gate = new Promise<void>((resolve) => {
    fetched = resolve;
  });

  const api = new Hono();
  mountSharingHost(api, fixture.store, fixture.data, {
    fetchRepository: async (target, _url, ...rest) => {
      await gate;
      await fetchPinnedRepository(target, fixture.repo, ...rest);
    },
  });

  const start = () =>
    api.request("/sharing/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });

  try {
    const response = await start();
    expect(response.status).toBe(202);
    const { reviewId } = await response.json();

    const status = async () =>
      (await api.request(`/sharing/import/${reviewId}`)).json();

    expect(await status()).toMatchObject({ stage: "downloading" });
    await start();
    await vi.waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(1));

    download({
      bundle,
      attribution: { login: "sender", sharedAt: 1 },
      revision: meta.revision,
      latest: R,
    });
    await vi.waitFor(async () =>
      expect(await status()).toMatchObject({ stage: "fetching" }),
    );
    fetched();
    await vi.waitFor(
      async () =>
        expect(await status()).toMatchObject({
          stage: "ready",
          title: "Sharing pinned commits",
        }),
      { timeout: 10000 },
    );

    const { reviewId: copy } = await status();

    expect(fixture.store.read(copy).shared).toMatchObject({ login: "sender" });
    expect((await start()).status).toBe(202);
    await vi.waitFor(async () =>
      expect(await status()).toMatchObject({ stage: "ready", reviewId: copy }),
    );
    expect(sharedSpy).toHaveBeenCalledTimes(2);
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).toHaveBeenCalledWith(capability, R);
  } finally {
    fetched();
    await fixture.data.close();
    fixture.store.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function importer() {
  const root = await mkdtemp(path.join(tmpdir(), "share-import-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  const fixture = await createShareFixture(root);
  const bundle = await exportShare(fixture);
  const api = new Hono();

  mountSharingHost(api, fixture.store, fixture.data, {
    fetchRepository: (target, _url, ...rest) =>
      fetchPinnedRepository(target, fixture.repo, ...rest),
  });

  const start = async (link = url) =>
    (
      await api.request("/sharing/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: link }),
      })
    ).json();

  const status = async (id: string) =>
    (await api.request(`/sharing/import/${id}`)).json();

  const close = async () => {
    await fixture.data.close();
    fixture.store.close();
    await rm(root, { recursive: true, force: true });
  };

  return { bundle, start, status, close, store: fixture.store };
}

it("opens the newest copy when the share service cannot answer, else reports it unavailable", async () => {
  const { bundle, start, status, close } = await importer();
  const sharedSpy = vi.spyOn(ShareClient.prototype, "shared");

  vi.spyOn(ShareClient.prototype, "download").mockResolvedValue({
    bundle,
    attribution: { login: "sender", sharedAt: 1 },
    revision: meta.revision,
    latest: R,
  });

  try {
    sharedSpy.mockRejectedValue(new Error("Share request failed (404)."));

    const { reviewId: id } = await start();

    await vi.waitFor(async () =>
      expect(await status(id)).toMatchObject({
        stage: "error",
        error:
          "This share is unavailable, revoked, or needs a newer Whiteboard version.",
      }),
    );

    sharedSpy.mockResolvedValue(meta);
    await start();
    await vi.waitFor(
      async () => expect(await status(id)).toMatchObject({ stage: "ready" }),
      { timeout: 10000 },
    );

    const { reviewId: copy } = await status(id);

    sharedSpy.mockRejectedValue(new Error("Share request failed (404)."));
    await start();
    await vi.waitFor(async () =>
      expect(await status(id)).toMatchObject({
        stage: "ready",
        reviewId: copy,
      }),
    );
    expect(sharedSpy).toHaveBeenCalledTimes(3);
  } finally {
    await close();
  }
});

it("opens an existing copy while another link's import is still downloading", async () => {
  const { bundle, start, status, close } = await importer();
  const other = `https://app.dev.fast/s/${"b".repeat(43)}`;

  vi.spyOn(ShareClient.prototype, "shared").mockResolvedValue(meta);
  vi.spyOn(ShareClient.prototype, "download").mockImplementation(
    async (link) => {
      if (link !== capability) await new Promise(() => {});

      return {
        bundle,
        attribution: { login: "sender", sharedAt: 1 },
        revision: meta.revision,
        latest: R,
      };
    },
  );

  try {
    const { reviewId: id } = await start();

    await vi.waitFor(
      async () => expect(await status(id)).toMatchObject({ stage: "ready" }),
      { timeout: 10000 },
    );

    const { reviewId: copy } = await status(id);
    const { reviewId: held } = await start(other);

    await start();
    await vi.waitFor(async () =>
      expect(await status(id)).toMatchObject({
        stage: "ready",
        reviewId: copy,
      }),
    );
    expect(await status(held)).toMatchObject({ stage: "downloading" });
  } finally {
    await close();
  }
});

it("keeps a revision link's import apart from the live link's", async () => {
  const { start, status, close } = await importer();

  const sharedSpy = vi
    .spyOn(ShareClient.prototype, "shared")
    .mockRejectedValue(new Error("Share request failed (404)."));

  try {
    const { reviewId } = await start(`${url}?rev=${R}`);

    expect(reviewId).toBe(
      `${shareKey("https://app.dev.fast", capability)}-${R}`,
    );
    await vi.waitFor(async () =>
      expect(await status(reviewId)).toMatchObject({ stage: "error" }),
    );
    expect(sharedSpy).toHaveBeenCalledWith(capability, R);
  } finally {
    await close();
  }
});

it("opens the copy a link prefers when the share service cannot answer", async () => {
  const { start, status, close, store } = await importer();
  const key = shareKey("https://app.dev.fast", capability);
  const [older, newer] = [randomUUID(), randomUUID()];

  vi.spyOn(ShareClient.prototype, "shared").mockRejectedValue(
    new Error("Share request failed (404)."),
  );

  const copy = async (shared: SharedProvenance) =>
    (
      await store.execute(
        { operation: { type: "create", title: "Copy" } },
        { document: [], shared: { key, ...shared } },
        { kind: "person" },
      )
    ).reviewId;

  const opens = async (link: string, reviewId: string) => {
    const { reviewId: id } = await start(link);

    await vi.waitFor(async () =>
      expect(await status(id)).toMatchObject({ stage: "ready", reviewId }),
    );
  };

  try {
    const live = await copy({ revisionId: older });
    const pinned = await copy({ revisionId: newer, pinned: true });

    await opens(url, live);
    await opens(`${url}?rev=${older}`, live);
    await opens(`${url}?rev=${randomUUID()}`, pinned);
  } finally {
    await close();
  }
});

it("reports a revoke through onRevoked", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "share-revoke-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  vi.stubEnv("DEV_REVIEW_SHARE_TOKEN", "token");
  const fixture = await createShareFixture(root);
  const api = new Hono();
  const revoked: string[] = [];

  const revoke = vi
    .spyOn(ShareClient.prototype, "revoke")
    .mockResolvedValue({});

  mountSharingHost(api, fixture.store, fixture.data, {
    onRevoked: ({ shareId }) => revoked.push(shareId),
  });

  try {
    const shareId = randomUUID();

    const response = await api.request("/sharing/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shareId }),
    });

    expect(response.status).toBe(200);
    expect(revoked).toEqual([shareId]);
  } finally {
    revoke.mockRestore();
    await fixture.data.close();
    fixture.store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("reports one start and one outcome per login attempt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "share-login-telemetry-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  const fixture = await createShareFixture(root);
  const api = new Hono();
  const outcomes: Array<[string, string | undefined]> = [];
  const finishes: Array<(code: number) => void> = [];

  mountSharingHost(api, fixture.store, fixture.data, {
    login: async () =>
      new Promise<number>((resolve) => {
        finishes.push(resolve);
      }),
    openUrl: async () => {},
    onLogin: (outcome, reason) => outcomes.push([outcome, reason]),
  });

  try {
    await api.request("/sharing/login", { method: "POST" });
    await api.request("/sharing/login", { method: "POST" });
    finishes[0](1);
    await vi.waitFor(() => expect(outcomes).toHaveLength(2));
    await api.request("/sharing/login", { method: "POST" });
    finishes[1](0);
    await vi.waitFor(() => expect(outcomes).toHaveLength(4));
    expect(outcomes).toEqual([
      ["started", undefined],
      ["failed", "did_not_finish"],
      ["started", undefined],
      ["succeeded", undefined],
    ]);
  } finally {
    await fixture.data.close();
    fixture.store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("reports the saved sign-in and forgets it on sign-out", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "share-logout-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  const fixture = await createShareFixture(root);
  const api = new Hono();
  mountSharingHost(api, fixture.store, fixture.data);

  try {
    await writeStoreAuth({
      origin: "https://app.dev.fast",
      token: "token",
      login: "Octo Cat",
      githubLogin: "octocat",
      savedAt: new Date().toISOString(),
    });
    expect(await (await api.request("/sharing/account")).json()).toEqual({
      account: {
        login: "Octo Cat",
        origin: "https://app.dev.fast",
        githubLogin: "octocat",
      },
      pending: false,
    });
    expect(
      await (await api.request("/sharing/logout", { method: "POST" })).json(),
    ).toEqual({ account: null, pending: false });
    expect(await readStoreAuth()).toBeNull();
  } finally {
    await fixture.data.close();
    fixture.store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("opens a share revision in the browser and refuses any other URL", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "share-open-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  const fixture = await createShareFixture(root);
  const api = new Hono();
  const openUrl = vi.fn<typeof openUrlInBrowser>(async () => {});
  api.onError((error, context) =>
    context.json(
      { error: error.message },
      error instanceof ReviewInputError ? error.status : 500,
    ),
  );
  mountSharingHost(api, fixture.store, fixture.data, { openUrl });

  const post = (path: string, body: { url: string }) =>
    api.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    expect(
      (await post("/sharing/open", { url: `${url}?rev=${R}` })).status,
    ).toBe(200);
    expect(openUrl).toHaveBeenCalledWith(`${url}?rev=${R}`);

    for (const url of [
      "https://evil.test/s/" + capability,
      "file:///etc/passwd",
    ])
      expect((await post("/sharing/open", { url })).status).toBe(400);
    expect(openUrl).toHaveBeenCalledTimes(1);
  } finally {
    await fixture.data.close();
    fixture.store.close();
    await rm(root, { recursive: true, force: true });
  }
});
