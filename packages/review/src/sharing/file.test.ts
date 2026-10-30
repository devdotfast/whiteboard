import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { createShareFixture } from "../../test/fixtures/share/create.js";
import { exportShare } from "./export.js";
import {
  parseWhiteboardFile,
  whiteboardFileName,
  whiteboardFileText,
} from "./file.js";

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
