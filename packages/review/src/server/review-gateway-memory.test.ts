import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  gatewayMemoryPath,
  openGatewayMemory,
} from "./review-gateway-memory.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "review-gateway-memory-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it("keeps each server's reviews under its last alias in an owner-only file", async () => {
  const memory = openGatewayMemory(home);
  memory.remember("server-1", "devbox", "review-1");
  memory.remember("server-1", "devbox", "review-2");
  memory.remember("server-2", "other", "review-3");
  await memory.flush();

  expect((await stat(gatewayMemoryPath(home))).mode & 0o777).toBe(0o600);

  const reopened = openGatewayMemory(home);
  expect(reopened.owner("review-2")).toEqual({
    serverId: "server-1",
    alias: "devbox",
  });
  expect(reopened.owner("review-3")).toEqual({
    serverId: "server-2",
    alias: "other",
  });
  expect(reopened.owner("review-4")).toBeUndefined();
});

it("loses nothing when a server's alias is renamed", async () => {
  const memory = openGatewayMemory(home);
  memory.remember("server-1", "devbox", "review-1");
  memory.remember("server-1", "renamed", "review-2");
  await memory.flush();

  const reopened = openGatewayMemory(home);
  expect(reopened.owner("review-1")).toEqual({
    serverId: "server-1",
    alias: "renamed",
  });
  expect(JSON.parse(await readFile(gatewayMemoryPath(home), "utf8"))).toEqual({
    "server-1": { alias: "renamed", reviewIds: ["review-1", "review-2"] },
  });
});

it("forgets a review its owner no longer has", async () => {
  const memory = openGatewayMemory(home);
  memory.remember("server-1", "devbox", "review-1");
  memory.remember("server-1", "devbox", "review-2");
  memory.forget("review-1");
  await memory.flush();

  expect(openGatewayMemory(home).owner("review-1")).toBeUndefined();
  expect(openGatewayMemory(home).owner("review-2")).toBeDefined();
});

it("starts empty from an unreadable file and says so", async () => {
  await writeFile(gatewayMemoryPath(home), "{not json");
  const messages: string[] = [];
  const memory = openGatewayMemory(home, (message) => messages.push(message));

  expect(memory.owner("review-1")).toBeUndefined();
  expect(messages).toEqual([
    expect.stringContaining("Ignoring unreadable remote review memory"),
  ]);
});

it("keeps each server's last list, and knows the owner of every review in it", async () => {
  const entry = {
    reviewId: "review-1",
    version: 1,
    title: "Listed",
    createdAt: "2026-09-30T00:00:00.000Z",
    repositoryName: "project",
    viewedAt: null,
    dismissedAt: null,
  };

  const memory = openGatewayMemory(home);
  memory.setList("server-1", "devbox", "structural", [entry]);
  memory.setList("server-1", "devbox", "structural", [
    { ...entry, title: "Renamed" },
  ]);
  await memory.flush();

  const reopened = openGatewayMemory(home);
  expect(reopened.list("server-1", "structural")).toEqual([
    { ...entry, title: "Renamed" },
  ]);
  expect(reopened.list("server-1", "textual")).toBeUndefined();
  expect(reopened.owner("review-1")).toEqual({
    serverId: "server-1",
    alias: "devbox",
  });
  expect(reopened.serverIdOf("devbox")).toBe("server-1");
});

it("gives an id two lists hold to the server first in the given order, and follows a renamed alias", async () => {
  const entry = {
    reviewId: "review-1",
    version: 1,
    title: "Listed twice",
    createdAt: "2026-09-30T00:00:00.000Z",
    repositoryName: "project",
    viewedAt: null,
    dismissedAt: null,
  };

  const memory = openGatewayMemory(home);
  memory.setList("server-1", "one", "structural", [entry]);
  memory.setList("server-2", "two", "structural", [entry]);

  expect(memory.owner("review-1", ["server-2", "server-1"])?.serverId).toBe(
    "server-2",
  );
  expect(memory.owner("review-1", ["server-1", "server-2"])?.serverId).toBe(
    "server-1",
  );

  memory.setList("server-2", "renamed", "structural", [entry]);
  expect(memory.alias("server-2")).toBe("renamed");
});
