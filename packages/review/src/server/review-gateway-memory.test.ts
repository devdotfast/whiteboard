import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  gatewayMemoryPath,
  listEntriesSchema,
  openGatewayMemory,
} from "./review-gateway-memory.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "review-gateway-memory-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const entry = {
  reviewId: randomUUID(),
  version: 1,
  title: "Listed",
  createdAt: "2026-09-30T00:00:00.000Z",
  repositoryName: "project",
  viewedAt: null,
  trashedAt: null,
};

it("keeps each server's last list under its last alias in an owner-only file", async () => {
  const memory = openGatewayMemory(home);
  memory.setList("server-1", "devbox", "structural", [entry]);
  memory.setList("server-1", "devbox", "structural", [
    { ...entry, title: "Renamed" },
  ]);
  memory.rename("server-1", "renamed");
  await memory.flush();

  expect((await stat(gatewayMemoryPath(home))).mode & 0o777).toBe(0o600);

  const reopened = openGatewayMemory(home);
  expect(reopened.list("server-1", "structural")).toEqual([
    { ...entry, title: "Renamed" },
  ]);
  expect(reopened.list("server-1", "textual")).toBeUndefined();
  expect(reopened.serverIdOf("renamed")).toBe("server-1");
  expect(reopened.serverIdOf("devbox")).toBeUndefined();
});

it("starts empty from an unreadable file and says so", async () => {
  await writeFile(gatewayMemoryPath(home), "{not json");
  const messages: string[] = [];
  const memory = openGatewayMemory(home, (message) => messages.push(message));

  expect(memory.serverIdOf("devbox")).toBeUndefined();
  expect(messages).toHaveLength(1);
});

it("keeps only UUID reviews from a host's list, never its scratchpad or shared reviews", () => {
  expect(
    listEntriesSchema.parse([
      { ...entry, reviewId: "scratchpad" },
      { ...entry, reviewId: `shared-${"a".repeat(64)}` },
      entry,
    ]),
  ).toEqual([entry]);
});
