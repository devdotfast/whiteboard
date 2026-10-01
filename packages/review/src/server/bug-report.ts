import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { type JsonValue } from "@dev.fast/json";
import {
  type ReviewBugReportMetaV2,
  type ReviewBugReportRequest,
  parseReviewBugReportResponse,
} from "@dev.fast/review-protocol";
import { readReviewPackageVersion } from "@review/package-paths";
import { type PostHogCaptureProperties } from "@review/posthog-capture-client";
import { type ReviewDiffFilesResult } from "@review/review-diff-files";

const BUG_REPORT_URL = "https://bug.dev.fast/api/v2/reports";

const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

const UPSTREAM_TIMEOUT_MS = 20_000;

type AttachmentName = "review" | "map" | "diff";

type AttachmentError = {
  attachment: AttachmentName;
  error: "unavailable";
};

export interface BugReportPayload {
  schema_version: 4;
  description: string;
  screenshot?: { mime: "image/jpeg"; base64: string };
  // File name to text. The document alone cannot render: every anchor lives in
  // a sibling TypeScript module.
  review?: Record<string, string>;
  map?: string;
  diff?: ReviewDiffFilesResult;
  diagnostics: {
    app_version: string;
    cli_version: string;
    platform: NodeJS.Platform;
    app_session_id: string;
    client_error_names: string[];
    attachment_errors?: AttachmentError[];
    // Review source files the report did not send, by name. Triage reads a
    // missing module as a rendering bug unless the report says it dropped one.
    review_omitted_files?: string[];
    /** The telemetry envelope, so triage can tell channel, environment and surface apart. */
    telemetry?: Record<string, JsonValue>;
  };
}

export class BugReportUpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BugReportUpstreamError";
  }
}

export interface BugReportSource {
  review(): Promise<{ files: Record<string, string>; omitted: string[] }>;
  map(): Promise<string | null>;
  diff(): Promise<ReviewDiffFilesResult>;
}

export async function submitReviewBugReport(input: {
  report: ReviewBugReportRequest;
  clientErrorNames: string[];
  fetchImpl?: typeof fetch;
  source: BugReportSource;
  telemetryEnvelope?: PostHogCaptureProperties;
}) {
  const cliVersion = readReviewPackageVersion();
  const attachmentErrors: AttachmentError[] = [];

  const payload: BugReportPayload = {
    schema_version: 4,
    description: input.report.description,
    diagnostics: {
      app_version: input.report.app_version,
      cli_version: cliVersion,
      platform: process.platform,
      app_session_id: input.report.app_session_id,
      client_error_names: input.clientErrorNames.slice(-20),
    },
  };

  if (input.telemetryEnvelope) {
    payload.diagnostics.telemetry = Object.fromEntries(
      Object.entries(input.telemetryEnvelope).filter(
        (entry): entry is [string, JsonValue] => entry[1] !== undefined,
      ),
    );
  }

  if (input.report.screenshot) payload.screenshot = input.report.screenshot;

  let reviewSource: Record<string, string> | undefined;
  let omittedReviewFiles: string[] | undefined;
  let mapSource: string | undefined;
  let changedFileDiffs: ReviewDiffFilesResult | undefined;
  const tasks: Array<Promise<void>> = [];

  if (input.report.include_review) {
    tasks.push(
      input.source.review().then(
        (result) => {
          reviewSource = result.files;

          if (result.omitted.length > 0) omittedReviewFiles = result.omitted;
        },
        () => {
          attachmentErrors.push(unavailable("review"));
        },
      ),
    );
  }

  if (input.report.include_map) {
    tasks.push(
      input.source.map().then(
        // A review does not need a software map: #840 split document and map
        // publishing, so "no map" is a normal state, not a failed read.
        // `readSoftwareMapSourceForRef` returns null when there is nothing to
        // send and throws when a read fails, so only the throw is an error.
        (source) => {
          if (source !== null) mapSource = source;
        },
        () => {
          attachmentErrors.push(unavailable("map"));
        },
      ),
    );
  }

  if (input.report.include_diff) {
    tasks.push(
      input.source.diff().then(
        (diff) => {
          changedFileDiffs = diff;
        },
        () => {
          attachmentErrors.push(unavailable("diff"));
        },
      ),
    );
  }

  await Promise.all(tasks);

  if (reviewSource !== undefined) payload.review = reviewSource;

  if (omittedReviewFiles !== undefined) {
    payload.diagnostics.review_omitted_files = omittedReviewFiles;
  }

  if (mapSource !== undefined) payload.map = mapSource;

  if (changedFileDiffs !== undefined) payload.diff = changedFileDiffs;

  if (attachmentErrors.length > 0) {
    payload.diagnostics.attachment_errors = attachmentErrors.sort(byAttachment);
  }

  const response = await (input.fetchImpl ?? fetch)(BUG_REPORT_URL, {
    method: "POST",
    body: buildBugReportRequest(payload, {
      appVersion: input.report.app_version,
      cliVersion,
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  }).catch((error) => {
    throw new BugReportUpstreamError(
      502,
      error instanceof Error ? error.message : "Bug report service failed.",
    );
  });

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    throw new BugReportUpstreamError(
      response.status === 429 || response.status === 413
        ? response.status
        : 502,
      response.status === 429
        ? "Too many reports. Try again later."
        : response.status === 413
          ? "Bug report is too large."
          : "Bug report service failed.",
    );
  }

  const result = parseReviewBugReportResponse(responseBody);

  if (!result.ok) throw new BugReportUpstreamError(502, result.error);

  return result;
}

function buildBugReportRequest(
  payload: BugReportPayload,
  input: {
    appVersion: string;
    cliVersion: string;
    maxPayloadBytes?: number;
  },
): FormData {
  const maxPayloadBytes = input.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
  let truncatedDiff = false;
  let truncatedMap = false;
  let truncatedScreenshot = false;
  let payloadBytes = gzipPayload(payload);

  if (payloadBytes.byteLength > maxPayloadBytes && payload.diff) {
    delete payload.diff;
    truncatedDiff = true;
    payloadBytes = gzipPayload(payload);
  }

  if (payloadBytes.byteLength > maxPayloadBytes && payload.map) {
    delete payload.map;
    truncatedMap = true;
    payloadBytes = gzipPayload(payload);
  }

  if (payloadBytes.byteLength > maxPayloadBytes && payload.screenshot) {
    delete payload.screenshot;
    truncatedScreenshot = true;
    payloadBytes = gzipPayload(payload);
  }

  if (payloadBytes.byteLength > maxPayloadBytes && payload.review) {
    delete payload.review;
    payloadBytes = gzipPayload(payload);
  }

  if (payloadBytes.byteLength > maxPayloadBytes) {
    throw new BugReportUpstreamError(413, "Bug report is too large.");
  }

  const meta: ReviewBugReportMetaV2 = {
    schema_version: 2,
    description_length: Buffer.byteLength(payload.description),
    has_review: payload.review !== undefined,
    has_map: payload.map !== undefined,
    has_diff: payload.diff !== undefined,
    has_screenshot: payload.screenshot !== undefined,
    has_trace: false,
    payload_bytes: payloadBytes.byteLength,
    app_version: input.appVersion,
    cli_version: input.cliVersion,
    platform: process.platform,
    truncated_diff: truncatedDiff,
    truncated_map: truncatedMap,
    truncated_screenshot: truncatedScreenshot,
    truncated_trace: false,
    parts: [
      {
        field: "payload",
        filename: "payload.json.gz",
        bytes: payloadBytes.byteLength,
        sha256: sha256Bytes(payloadBytes),
      },
    ],
  };

  if (payload.description.trim().length > 0) {
    meta.description = payload.description;
  }

  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  form.append(
    "payload",
    new Blob([Uint8Array.from(payloadBytes)], { type: "application/gzip" }),
    "payload.json.gz",
  );

  return form;
}

function gzipPayload(payload: BugReportPayload): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// The document is required: a failure to read it makes the attachment
// unavailable. Each TypeScript module is optional, because a report that loses
// one module is still better than a report that loses the review.
function unavailable(attachment: AttachmentName): AttachmentError {
  return { attachment, error: "unavailable" };
}

function byAttachment(left: AttachmentError, right: AttachmentError): number {
  return left.attachment.localeCompare(right.attachment);
}
