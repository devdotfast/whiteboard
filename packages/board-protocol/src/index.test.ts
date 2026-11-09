import { describe, expect, it } from "vitest";

import { boardLineSchema, lensEditRequestSchema } from "./index.js";

const op = {
  kind: "op",
  seq: 4,
  nextId: 5,
  author: "agent",
  at: 1,
  activity: { workingCount: 0, expiresAt: null },
};

describe("boardLineSchema", () => {
  it("parses a lens op", () => {
    const line = {
      ...op,
      edit: {
        type: "lens_edit",
        edit: {
          type: "insert",
          title: "Tests",
          targets: [{ kind: "files", patterns: ["**/*.test.ts"] }],
        },
      },
    };

    expect(boardLineSchema.parse(line)).toEqual(line);
  });

  it("still parses a document op", () => {
    const line = {
      ...op,
      edit: {
        type: "insert",
        content: { type: "markdown", markdown: "Hello" },
      },
    };

    expect(boardLineSchema.parse(line)).toEqual(line);
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
