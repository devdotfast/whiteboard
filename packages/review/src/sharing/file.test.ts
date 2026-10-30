import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ReviewInputError } from "@dev.fast/whiteboard-document";
import { openLocalReviewStore } from "@review/review-api/local-data.js";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { exportShare } from "./export.js";
import {
  parseWhiteboardFile,
  whiteboardFileName,
  whiteboardFileText,
} from "./file.js";
import { mountSharingHost, mountSharingPublisher } from "./host.js";
import { fetchPinnedRepository } from "./repository.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllEnvs();

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

async function recipientApi() {
  const sender = await fixture();

  const recipient = openLocalReviewStore(
    path.join(sender.root, "recipient.db"),
  );

  cleanup.push(() => recipient.store.close());
  cleanup.push(() => recipient.data.close());
  vi.stubEnv("DEV_REVIEW_HOME", sender.root);

  const api = new Hono();
  api.onError((error, context) =>
    context.json(
      { error: error.message },
      error instanceof ReviewInputError ? error.status : 500,
    ),
  );
  mountSharingHost(api, recipient.store, recipient.data, {
    fetchRepository: (target, _url, ...rest) =>
      fetchPinnedRepository(target, sender.repo, ...rest),
  });

  const text = whiteboardFileText(
    await exportShare({
      ...sender,
      reviewId: sender.reviewId,
      repository: sender.repository,
    }),
  );

  const file = path.join(sender.root, "board.whiteboard");
  await writeFile(file, text);

  const open = async (body: { path: string } | { url: string }) => {
    const started = await api.request("/sharing/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (started.status !== 202)
      return { status: started.status, ...(await started.json()) };
    const { reviewId: id } = await started.json();

    for (;;) {
      const status = await (await api.request(`/sharing/import/${id}`)).json();

      if (status.stage === "ready" || status.stage === "error")
        return { status: 202, ...status };
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  return { sender, recipient, file, open };
}

it("imports a .whiteboard file once per content", async () => {
  const { sender, recipient, file, open } = await recipientApi();

  const first = await open({ path: file });

  expect(first.stage).toBe("ready");
  expect(first.title).toBe("Sharing pinned commits");
  expect(recipient.store.read(first.reviewId).shared?.cloneUrl).toBe(
    sender.repository.cloneUrl,
  );

  expect(await open({ path: file })).toMatchObject({
    stage: "ready",
    reviewId: first.reviewId,
  });
});

it("reports a file that is not a whiteboard", async () => {
  const { sender, open } = await recipientApi();
  const file = path.join(sender.root, "notes.whiteboard");
  await writeFile(file, "nope");

  expect(await open({ path: file })).toMatchObject({
    stage: "error",
    error: "This is not a Whiteboard file.",
  });
});

it("reports a file it cannot read", async () => {
  const { sender, open } = await recipientApi();

  expect(
    await open({ path: path.join(sender.root, "gone.whiteboard") }),
  ).toEqual({
    status: 400,
    error:
      "Could not read gone.whiteboard. Check that the file still exists and Whiteboard can open it.",
  });
});

it("refuses a relative file path", async () => {
  const { open } = await recipientApi();

  expect(await open({ path: "board.whiteboard" })).toMatchObject({
    status: 400,
  });
});
