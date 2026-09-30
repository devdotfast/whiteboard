import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readReviewPackageVersion } from "@review/package-paths.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createGatewayHosts } from "./review-gateway-hosts.js";
import {
  startFake,
  startRemote,
  stopAll,
} from "./review-gateway-test-utils.js";

const version = readReviewPackageVersion(import.meta.url);

let root: string;

const closes: (() => void)[] = [];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "review-gateway-hosts-"));
  vi.stubEnv("DEV_REVIEW_HOME", root);
  vi.stubEnv("DEV_FAST_REVIEW_TELEMETRY_DISABLED", "1");
});

afterEach(async () => {
  for (const close of closes.splice(0)) close();
  await stopAll();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function hosts(laptopVersion = version) {
  const created = createGatewayHosts({ version: laptopVersion });
  closes.push(() => created.close());

  return created;
}

it("never contacts a host that arrives with a problem", async () => {
  const fake = await startFake({ version });
  const gateway = hosts();

  gateway.set([
    {
      alias: "devbox",
      endpoint: fake.endpoint,
      problem: { state: "auth-failed", detail: "Permission denied." },
    },
    { alias: "later" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 200));

  expect(gateway.states()).toEqual([
    { alias: "devbox", state: "auth-failed", detail: "Permission denied." },
    { alias: "later", state: "connecting", detail: expect.any(String) },
  ]);
  expect(fake.requests).toEqual([]);
});

it("refuses a host on another version and names the install command", async () => {
  const remote = await startRemote(path.join(root, "a"));
  const gateway = hosts("0.0.0-other");

  gateway.set([{ alias: "devbox", endpoint: remote.endpoint }]);

  await expect.poll(() => gateway.states()[0]?.state).toBe("incompatible");
  const [state] = gateway.states();
  expect(state?.serverId).toBe((await remote.health()).serverId);
  expect(state?.detail).toContain(version);
  expect(state?.detail).toContain("0.0.0-other");
  expect(state?.detail).toContain(
    "npm install -g @dev.fast/whiteboard@0.0.0-other",
  );
  expect(gateway.online()).toEqual([]);
});

it("refuses a host whose version could not be read", async () => {
  const fake = await startFake({ version: "unknown" });
  const gateway = hosts("unknown");

  gateway.set([{ alias: "devbox", endpoint: fake.endpoint }]);

  await expect.poll(() => gateway.states()[0]?.state).toBe("incompatible");
});

it("treats one server under two aliases as one machine", async () => {
  const remote = await startRemote(path.join(root, "a"));
  const gateway = hosts();

  gateway.set([
    { alias: "first", endpoint: remote.endpoint },
    { alias: "second", endpoint: remote.endpoint },
  ]);

  const { serverId } = await remote.health();
  await expect
    .poll(() => gateway.states())
    .toEqual([
      { alias: "first", serverId, state: "online" },
      { alias: "second", serverId, state: "online" },
    ]);
  expect(gateway.serving(serverId)?.alias).toBe("first");
  expect(gateway.online().map((host) => host.alias)).toEqual(["first"]);
});

it("marks the second of two machines with a copied id as a duplicate", async () => {
  const first = await startRemote(path.join(root, "a"));
  await first.stop();
  await cp(path.join(root, "a"), path.join(root, "c"), { recursive: true });
  const a = await startRemote(path.join(root, "a"));
  const c = await startRemote(path.join(root, "c"));
  const { serverId } = await a.health();
  expect((await c.health()).serverId).toBe(serverId);

  const gateway = hosts();
  gateway.set([
    { alias: "wb-a", endpoint: a.endpoint },
    { alias: "wb-c", endpoint: c.endpoint },
  ]);

  await expect.poll(() => gateway.states()[1]?.state).toBe("duplicate");
  const [online, duplicate] = gateway.states();
  expect(online).toEqual({ alias: "wb-a", serverId, state: "online" });
  expect(duplicate?.detail).toContain("wb-a");
  expect(duplicate?.detail).toContain("wb-c");
  expect(duplicate?.detail).toContain("whiteboard server reset-id");
  expect(gateway.online().map((host) => host.alias)).toEqual(["wb-a"]);
});

it("retries an offline host until it answers", async () => {
  const fake = await startFake({ version });
  await fake.stop();
  const gateway = hosts();

  gateway.set([{ alias: "devbox", endpoint: fake.endpoint }]);
  await expect.poll(() => gateway.states()[0]?.state).toBe("offline");

  await startFake({ version }, fake.port);
  await expect
    .poll(() => gateway.states()[0]?.state, { timeout: 5_000 })
    .toBe("online");
});
