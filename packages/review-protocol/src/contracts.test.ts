import { type JsonObject } from "@dev.fast/json";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import {
  REVIEW_DESKTOP_DISCOVERY_VERSION,
  ReviewCliInstallStampSchema,
  ReviewDesktopDiscoverySchema,
  ReviewDesktopStateSchema,
  ReviewDesktopVerbFrameSchema,
  ReviewDesktopVerbResultSchema,
  ReviewDiffFileSchema,
  ReviewDiffFilesRequestSchema,
  ReviewDiffFilesResponseSchema,
  ReviewEditorSelectionSchema,
  ReviewErrorResponseSchema,
  ReviewFileContentRequestSchema,
  ReviewFileContentResponseSchema,
  ReviewOpenEditorSchema,
  ReviewRangeSchema,
  ReviewRepositoryIdentitySchema,
  ReviewRuntimeConfigSchema,
  ReviewSurfaceEventSchema,
  ReviewVerbRequestSchema,
  ReviewVerbResponseSchema,
  summarizeReviewDiffFiles,
} from "./contracts.js";

const repository = {
  kind: "jj",
  repositoryId: "repo-1",
  repositoryPath: "/tmp/repo/.jj/repo",
  worktreeRoot: "/tmp/repo",
};

const contracts: Array<[string, ZodType, JsonObject]> = [
  [
    "CLI install stamp",
    ReviewCliInstallStampSchema,
    {
      consent: "skipped",
      updatedAt: "2026-08-09T00:00:00.000Z",
    },
  ],
  [
    "runtime config",
    ReviewRuntimeConfigSchema,
    {
      serverUrl: "http://127.0.0.1:5570",
      reviewId: "review-1",
      token: "",
      wasmUrl: "http://127.0.0.1:5570/libavoid.wasm",
      appVersion: "0.0.13",
      theme: "dark",
      host: "desktop",
    },
  ],
  [
    "desktop discovery",
    ReviewDesktopDiscoverySchema,
    {
      version: REVIEW_DESKTOP_DISCOVERY_VERSION,
      instanceId: "desktop-1",
      url: "http://127.0.0.1:5570",
      appPid: 1,
      serverPid: 2,
      token: "token",
      startedAt: 3,
    },
  ],
  ["repository identity", ReviewRepositoryIdentitySchema, repository],

  [
    "diff file",
    ReviewDiffFileSchema,
    {
      path: "src/index.ts",
      status: "modified",
      additions: 1,
      deletions: 2,
    },
  ],
  [
    "diff request",
    ReviewDiffFilesRequestSchema,
    {
      includePatch: true,
      paths: ["src/index.ts"],
      commit: "a".repeat(40),
    },
  ],
  [
    "diff response",
    ReviewDiffFilesResponseSchema,
    {
      ok: true,
      files: [
        {
          path: "src/index.ts",
          status: "modified",
          additions: 1,
          deletions: 2,
        },
      ],
    },
  ],
  [
    "file content request",
    ReviewFileContentRequestSchema,
    { path: "src/index.ts", side: "head" },
  ],
  [
    "file content response",
    ReviewFileContentResponseSchema,
    { ok: true, content: "" },
  ],

  [
    "legacy error response",
    ReviewErrorResponseSchema,
    { ok: false, error: "bad" },
  ],

  ["range", ReviewRangeSchema, { fromLine: 1, toLine: 2 }],
  [
    "open editor",
    ReviewOpenEditorSchema,
    { path: "src/index.ts", scheme: "file" },
  ],
  [
    "editor selection",
    ReviewEditorSelectionSchema,
    {
      path: "src/index.ts",
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 2,
    },
  ],
  [
    "desktop state",
    ReviewDesktopStateSchema,
    {
      openEditors: [{ path: "src/index.ts", scheme: "file" }],
      activeEditor: null,
      selection: null,
    },
  ],
  ["verb request", ReviewVerbRequestSchema, { name: "focusWindow", args: {} }],
  ["verb response", ReviewVerbResponseSchema, { ok: true }],
  [
    "desktop verb frame",
    ReviewDesktopVerbFrameSchema,
    {
      event: "desktop-verb",
      id: "verb-1",
      request: { name: "focusWindow", args: {} },
    },
  ],
  [
    "desktop verb result",
    ReviewDesktopVerbResultSchema,
    {
      id: "verb-1",
      response: { ok: true },
    },
  ],
  [
    "surface event",
    ReviewSurfaceEventSchema,
    { event: "themeChanged", theme: "dark" },
  ],
];

describe("Review protocol Zod contracts", () => {
  it.each(contracts)("accepts a valid %s", (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  // Desktop discovery deliberately ignores unknown keys so future additive
  // fields never force another protocol version bump. The install stamp drops
  // the agent records that stamps from before version 2 carry.
  const tolerantContracts = new Set(["desktop discovery", "CLI install stamp"]);

  it.each(contracts)("rejects unknown keys in %s", (name, schema, value) => {
    expect(schema.safeParse({ ...value, unexpected: true }).success).toBe(
      tolerantContracts.has(name),
    );
  });
});

describe("summarizeReviewDiffFiles", () => {
  it("accepts the partial stats used by initial Review data", () => {
    expect(
      summarizeReviewDiffFiles([{ additions: 4 }, { deletions: 3 }]),
    ).toEqual({ fileCount: 2, additions: 4, deletions: 3 });
  });
});

describe("ReviewCliInstallStampSchema", () => {
  it("parses a legacy stamp and drops its agent records", () => {
    const stamp = ReviewCliInstallStampSchema.parse({
      consent: "granted",
      fingerprint: "abc",
      targets: ["claude", "codex"],
      shimPath: "/home/u/.local/bin/review",
      mcpRegistrations: [
        {
          target: "claude",
          configPath: "/x",
          command: "/y",
          args: ["mcp"],
          env: {},
        },
      ],
      fffRegistrations: [{ target: "claude", command: "claude", args: [] }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(stamp).toEqual({
      consent: "granted",
      fingerprint: "abc",
      shimPath: "/home/u/.local/bin/review",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
