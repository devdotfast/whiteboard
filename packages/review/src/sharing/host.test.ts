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
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { ShareClient } from "./client.js";
import { exportShare } from "./export.js";
import { mountSharingHost } from "./host.js";
import { fetchPinnedRepository } from "./repository.js";

afterEach(() => vi.unstubAllEnvs());

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

  let fetched!: () => void;

  const gate = new Promise<void>((resolve) => {
    fetched = resolve;
  });

  const api = new Hono();
  mountSharingHost(api, fixture.store, fixture.data, {
    fetchRepository: async (target, _url, pins, publishing, commits) => {
      await gate;
      await fetchPinnedRepository(
        target,
        fixture.repo,
        pins,
        publishing,
        commits,
      );
    },
  });
  const url = `https://app.dev.fast/s/${"a".repeat(43)}`;

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
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    download({ bundle, attribution: { login: "sender", sharedAt: 1 } });
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
    expect(await status()).toMatchObject({ stage: "ready", reviewId: copy });
    expect(downloadSpy).toHaveBeenCalledTimes(1);
  } finally {
    fetched();
    downloadSpy.mockRestore();
    await fixture.data.close();
    fixture.store.close();
    await rm(root, { recursive: true, force: true });
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
