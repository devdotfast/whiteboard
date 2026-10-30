import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ReviewInputError } from "@dev.fast/whiteboard-document";
import { Hono } from "hono";
import { afterEach, expect, it } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { exportShare } from "./export.js";
import {
  parseWhiteboardFile,
  whiteboardFileName,
  whiteboardFileText,
} from "./file.js";
import { mountSharingPublisher } from "./host.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "review-file-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));

  return { root, ...(await createShareFixture(root)) };
}

it("names the file after the board's title as a kebab slug", () => {
  expect(whiteboardFileName("My Board: v2!")).toBe("my-board-v2.whiteboard");
  expect(whiteboardFileName("")).toBe("untitled.whiteboard");
});

it("rejects text that is not a Whiteboard file", () => {
  expect(() => parseWhiteboardFile("nope")).toThrow(/not a Whiteboard file/);
  expect(() => parseWhiteboardFile("[1]")).toThrow(/not a Whiteboard file/);
  expect(() =>
    parseWhiteboardFile(JSON.stringify({ format: "review-share/1" })),
  ).toThrow(/different Whiteboard version/);
});

it("round-trips an exported bundle through its file text", async () => {
  const sender = await fixture();
  const bundle = await exportShare({ ...sender, reviewId: sender.reviewId });
  const text = whiteboardFileText(bundle);

  expect(text.endsWith("}\n")).toBe(true);
  expect(parseWhiteboardFile(text)).toEqual(bundle);
});

it("exports an untitled board to a file that reads back", async () => {
  const sender = await fixture();

  const { reviewId } = await sender.store.execute(
    {
      operation: {
        type: "create",
        target: sender.store.read(sender.reviewId).target,
      },
    },
    undefined,
    { kind: "person" },
  );

  await sender.store.execute({
    operation: {
      type: "edit",
      reviewId,
      edit: {
        type: "insert",
        content: { type: "markdown", markdown: "Untitled notes." },
      },
    },
  });

  const text = whiteboardFileText(await exportShare({ ...sender, reviewId }));

  expect(parseWhiteboardFile(text).title).toBe("");
});

it("serves a board as a named .whiteboard file", async () => {
  const sender = await fixture();
  const api = new Hono();
  api.onError((error, context) =>
    context.json(
      { error: error.message },
      error instanceof ReviewInputError ? error.status : 500,
    ),
  );
  mountSharingPublisher(api, sender.store, sender.data, {
    readRepository: async () => sender.repository,
  });

  const response = await api.request("/sharing/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewId: sender.reviewId }),
  });

  expect(response.status).toBe(200);
  const { filename, text } = await response.json();
  expect(filename).toBe("sharing-pinned-commits.whiteboard");
  const bundle = parseWhiteboardFile(text);
  expect(bundle.reviewId).toBe(sender.reviewId);
  expect(bundle.repository).toEqual(sender.repository);
});

it("refuses to export pinned code without a GitHub remote to fetch it from", async () => {
  const sender = await fixture();
  const api = new Hono();
  api.onError((error, context) =>
    context.json(
      { error: error.message },
      error instanceof ReviewInputError ? error.status : 500,
    ),
  );
  mountSharingPublisher(api, sender.store, sender.data, {
    readRepository: async () => {
      throw new Error("Sharing requires a GitHub repository remote.");
    },
  });

  const response = await api.request("/sharing/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reviewId: sender.reviewId }),
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error:
      "Exporting pinned code needs a GitHub remote the file's reader can fetch from.",
  });
});
