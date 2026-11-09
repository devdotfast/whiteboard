import { describe, expect, it } from "vitest";

import {
  boardLineSchema,
  boardSnapshotSchema,
  lensEditRequestSchema,
} from "./index.js";

const activity = { workingCount: 0, expiresAt: null };
const targets = [{ kind: "files", patterns: ["**/*.test.ts"] }];
const opLine = (edit: unknown) => ({
  kind: "op",
  seq: 4,
  edit,
  nextId: 5,
  author: "agent",
  at: 1,
  activity,
});

describe("boardLineSchema", () => {
  it("parses a lens op", () => {
    const line = opLine({
      type: "lens_edit",
      edit: { type: "insert", title: "Tests", targets },
    });
    expect(boardLineSchema.parse(line)).toEqual(line);
  });

  it("still parses a document op", () => {
    const line = opLine({
      type: "insert",
      content: { type: "markdown", markdown: "Hello" },
    });
    expect(boardLineSchema.parse(line)).toEqual(line);
  });
});

describe("boardSnapshotSchema", () => {
  it("round-trips lenses", () => {
    const snapshot = {
      reviewId: "r",
      version: 1,
      title: "Board",
      document: [],
      createdAt: "2026-11-09T00:00:00.000Z",
      lenses: [{ id: "lens-3", title: "Tests", targets }],
    };
    expect(boardSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
});

describe("lensEditRequestSchema", () => {
  it("rejects a document edit", () => {
    const result = lensEditRequestSchema.safeParse({
      edit: { type: "insert", content: { type: "markdown", markdown: "Hi" } },
    });
    expect(result.success).toBe(false);
  });
});
