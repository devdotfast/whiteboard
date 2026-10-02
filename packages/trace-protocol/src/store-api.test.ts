import { describe, expect, it } from "vitest";

import {
  MAX_TRACE_OBJECT_BYTES,
  MAX_TRACE_SESSIONS_PAGE,
  MAX_TRACE_SESSION_BYTES,
  beginUploadRequestSchema,
  completeUploadRequestSchema,
  createStoreRequestSchema,
  listSessionsQuerySchema,
  listSessionsResponseSchema,
  listUploadsQuerySchema,
  listUploadsResponseSchema,
  traceObjectKey,
  traceObjectNameSchema,
  uploadManifestMismatch,
} from "./store-api.js";

const id = "0123456789abcdef0123456789abcdef";

const sha = "a".repeat(64);

describe("store-api contracts", () => {
  it("rejects caller-selected upload owners and invalid status filters", () => {
    expect(listUploadsQuerySchema.safeParse({ owner: 7 }).success).toBe(false);
    expect(listUploadsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(
      listUploadsQuerySchema.parse({ session: "my-session", limit: "2" }),
    ).toEqual({ session: "my-session", limit: 2 });
    expect(
      listUploadsResponseSchema.parse({ storeId: id, uploads: [] }),
    ).toEqual({ storeId: id, uploads: [] });
  });

  it("accepts main and subagent object names only", () => {
    expect(traceObjectNameSchema.safeParse("main.jsonl.gz").success).toBe(true);
    expect(
      traceObjectNameSchema.safeParse("subagents/agent-a1.jsonl.gz").success,
    ).toBe(true);
    expect(traceObjectNameSchema.safeParse("../x.jsonl.gz").success).toBe(
      false,
    );
    expect(
      traceObjectNameSchema.safeParse("subagents/a/b.jsonl.gz").success,
    ).toBe(false);
    expect(traceObjectNameSchema.safeParse("main.jsonl").success).toBe(false);
  });

  it("requires lowercase hex sha256 and positive size", () => {
    const ok = beginUploadRequestSchema.safeParse({
      harness: "claude",
      objects: [{ name: "main.jsonl.gz", size: 10, sha256: sha }],
    });

    expect(ok.success).toBe(true);

    const bad = beginUploadRequestSchema.safeParse({
      harness: "claude",
      objects: [{ name: "main.jsonl.gz", size: 0, sha256: "A".repeat(64) }],
    });

    expect(bad.success).toBe(false);
  });

  it("rejects an object above the size cap", () => {
    const oversize = beginUploadRequestSchema.safeParse({
      harness: "claude",
      objects: [
        {
          name: "main.jsonl.gz",
          size: MAX_TRACE_OBJECT_BYTES + 1,
          sha256: sha,
        },
      ],
    });

    expect(oversize.success).toBe(false);
  });

  it("rejects duplicate names and a manifest above the session cap", () => {
    const duplicate = beginUploadRequestSchema.safeParse({
      harness: "claude",
      objects: [
        { name: "main.jsonl.gz", size: 10, sha256: sha },
        { name: "main.jsonl.gz", size: 11, sha256: sha },
      ],
    });

    expect(duplicate.success).toBe(false);
    const half = MAX_TRACE_SESSION_BYTES / 2;

    const total = beginUploadRequestSchema.safeParse({
      harness: "claude",
      objects: [
        { name: "main.jsonl.gz", size: half, sha256: sha },
        { name: "subagents/a.jsonl.gz", size: half, sha256: sha },
        { name: "subagents/b.jsonl.gz", size: 1, sha256: sha },
      ],
    });

    expect(total.success).toBe(false);
  });

  it("rejects a duplicate commit in a completion", () => {
    const commit = "b".repeat(40);
    expect(
      completeUploadRequestSchema.safeParse({ commits: [commit, commit] })
        .success,
    ).toBe(false);
    expect(completeUploadRequestSchema.parse({})).toEqual({ commits: [] });
  });

  it("finds every way a begin response can miss the manifest", () => {
    const manifest = [
      { name: "main.jsonl.gz" },
      { name: "subagents/a.jsonl.gz" },
    ];

    expect(uploadManifestMismatch(manifest, manifest)).toBeNull();
    expect(
      uploadManifestMismatch(manifest, [{ name: "main.jsonl.gz" }]),
    ).toContain("no upload for subagents/a.jsonl.gz");
    expect(
      uploadManifestMismatch(manifest, [
        ...manifest,
        { name: "main.jsonl.gz" },
      ]),
    ).toContain("twice");
    expect(
      uploadManifestMismatch(manifest, [
        ...manifest,
        { name: "subagents/b.jsonl.gz" },
      ]),
    ).toContain("did not declare");
  });

  it("places store and upload ids beneath the repository prefix", () => {
    expect(
      traceObjectKey({
        repositoryId: 42,
        storeId: id,
        sessionId: "session_1234",
        uploadId: id,
        name: "main.jsonl.gz",
      }),
    ).toBe(
      `r42/stores/${id}/sessions/session_1234/uploads/${id}/main.jsonl.gz`,
    );
    expect(() =>
      traceObjectKey({
        repositoryId: 42,
        storeId: "short",
        sessionId: "session_1234",
        uploadId: id,
        name: "main.jsonl.gz",
      }),
    ).toThrow(/storeId|Invalid|invalid/);
  });

  it("rejects owner/name with path characters", () => {
    expect(
      createStoreRequestSchema.safeParse({ owner: "a/b", name: "c" }).success,
    ).toBe(false);
  });

  it("pages the session listing with a bounded limit and a session cursor", () => {
    const commit = "b".repeat(40);
    expect(listSessionsQuerySchema.safeParse({ commit }).success).toBe(true);
    expect(
      listSessionsQuerySchema.safeParse({
        commit,
        limit: "50",
        cursor: "session-0009",
      }).success,
    ).toBe(true);
    expect(
      listSessionsQuerySchema.safeParse({ commit, limit: "0" }).success,
    ).toBe(false);
    expect(
      listSessionsQuerySchema.safeParse({
        commit,
        limit: String(MAX_TRACE_SESSIONS_PAGE + 1),
      }).success,
    ).toBe(false);
    expect(
      listSessionsResponseSchema.safeParse({
        sessions: [],
        nextCursor: "session-0009",
      }).success,
    ).toBe(true);
    // A repository-wide listing names no commit and no session.
    expect(listSessionsQuerySchema.safeParse({}).success).toBe(true);
    expect(
      listSessionsQuerySchema.safeParse({ limit: "50", cursor: "session-0009" })
        .success,
    ).toBe(true);
  });
});
