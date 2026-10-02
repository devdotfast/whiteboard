import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { type ReviewBugReportRequest } from "@dev.fast/review-protocol";
import { describe, expect, it, vi } from "vitest";

import { submitReviewBugReport } from "./bug-report";

describe("submitReviewBugReport", () => {
  it("sends schema 2 payload parts", async () => {
    const capture = captureFetch();

    await submitReviewBugReport({
      report: report(),
      source: reportSource(),
      clientErrorNames: [],
      fetchImpl: capture.fetchImpl,
    });

    expect(capture.url()).toBe("https://bug.dev.fast/api/v2/reports");
    expect(capture.headers().get("X-Review-Bug-Report-Schema")).toBeNull();
    expect(capture.parts().map((part) => part.name)).toEqual([
      "meta",
      "payload",
    ]);

    const meta = JSON.parse(capture.textPart("meta")) as {
      schema_version: number;
      has_trace: boolean;
      parts: Array<{ field: string; bytes: number; sha256: string }>;
    };

    expect(meta).toMatchObject({
      schema_version: 2,
      has_trace: false,
      parts: [{ field: "payload" }],
    });
    expect(meta).not.toHaveProperty("description");
    const payloadBytes = capture.filePart("payload");
    expect(JSON.parse(gunzipSync(payloadBytes).toString("utf8"))).toMatchObject(
      {
        schema_version: 4,
        description: "",
      },
    );
    expect(meta.parts[0].bytes).toBe(payloadBytes.byteLength);
    expect(meta.parts[0].sha256).toBe(sha256(payloadBytes));
  });

  it("includes a verbatim meaningful description in report metadata", async () => {
    const description = "First line\nSnow: 雪\nLast line";
    const capture = captureFetch();

    await submitReviewBugReport({
      report: report({ description }),
      source: reportSource(),
      clientErrorNames: [],
      fetchImpl: capture.fetchImpl,
    });

    expect(JSON.parse(capture.textPart("meta"))).toMatchObject({
      description,
      description_length: Buffer.byteLength(description),
    });
  });

  it("omits a whitespace-only description from report metadata", async () => {
    const capture = captureFetch();

    await submitReviewBugReport({
      report: report({ description: " \n\t " }),
      source: reportSource(),
      clientErrorNames: [],
      fetchImpl: capture.fetchImpl,
    });

    const meta = JSON.parse(capture.textPart("meta"));
    expect(meta).not.toHaveProperty("description");
    expect(meta.description_length).toBe(4);
  });

  it.each([503, 422])(
    "reports an upstream %s as a service failure without retrying",
    async (status) => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        Response.json({ ok: false, error: "Rejected." }, { status }),
      );

      await expect(
        submitReviewBugReport({
          report: report(),
          source: reportSource(),
          clientErrorNames: [],
          fetchImpl,
        }),
      ).rejects.toMatchObject({ status: 502 });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(fetchImpl.mock.calls[0][0].toString()).toBe(
        "https://bug.dev.fast/api/v2/reports",
      );
    },
  );

  function reportSource() {
    return {
      review: async () => ({ files: { "review.json": "{}" }, omitted: [] }),
      map: async () => null,
      diff: async () => ({ baseRef: "main", files: [] }),
    };
  }
});

function report(
  overrides: Partial<ReviewBugReportRequest> = {},
): ReviewBugReportRequest {
  return {
    description: "",
    include_review: false,
    include_map: false,
    include_diff: false,
    app_session_id: "session-1234567890",
    app_version: "1.2.3",
    ...overrides,
  };
}

interface CapturedFile {
  filename: string;
  type: string;
  bytes: Buffer;
}

type CapturedPart =
  | { name: string; text: string }
  | { name: string; file: CapturedFile };

interface CapturedFetch {
  fetchImpl: typeof fetch;
  url: () => string;
  headers: () => Headers;
  parts: () => CapturedPart[];
  textPart: (name: string) => string;
  filePart: (name: string) => Buffer;
}

function captureFetch(): CapturedFetch {
  let url: string | undefined;
  let headers: Headers | undefined;
  const capturedParts: CapturedPart[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    url = input.toString();
    headers = new Headers(init?.headers);
    const form = init?.body;

    if (!(form instanceof FormData)) throw new Error("Expected FormData.");

    for (const [name, value] of form.entries()) {
      capturedParts.push(
        value instanceof File
          ? {
              name,
              file: {
                filename: value.name,
                type: value.type,
                bytes: Buffer.from(await value.arrayBuffer()),
              },
            }
          : { name, text: value },
      );
    }

    return successResponse();
  };

  const part = (name: string) => {
    const result = capturedParts.find((candidate) => candidate.name === name);

    if (!result) throw new Error(`Missing captured ${name} part.`);

    return result;
  };

  return {
    fetchImpl,
    url: () => url ?? "",
    headers: () => headers ?? new Headers(),
    parts: () => capturedParts,
    textPart: (name) => {
      const captured = part(name);

      if (!("text" in captured)) throw new Error(`${name} is not text.`);

      return captured.text;
    },
    filePart: (name) => {
      const captured = part(name);

      if (!("file" in captured)) throw new Error(`${name} is not a file.`);

      return captured.file.bytes;
    },
  };
}

function successResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      report_id: "00000000-0000-4000-8000-000000000000",
      short_id: "123456789012",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
