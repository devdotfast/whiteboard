import { randomUUID } from "node:crypto";

import { type JsonValue, parseJsonText } from "@dev.fast/json";
import {
  MAX_SHARE_BYTES,
  type ShareBundle,
  capabilitySchema,
  shareBundleSchema,
} from "@dev.fast/review-share-protocol";
import {
  StreamLimitError,
  readBoundedStream,
} from "@review/server/bounded-stream.js";
import { z } from "zod";

import { shareRequestBody } from "./export.js";

const MAX_RESPONSE_BYTES = MAX_SHARE_BYTES;

const linkSchema = z.strictObject({ shareId: z.uuid(), url: z.url() });

const receivedSchema = z.object({
  sender: z.strictObject({ login: z.string().min(1).max(256) }),
  sharedAt: z.number(),
  size: z.number().int().positive().max(MAX_SHARE_BYTES),
});

/** Size is checked while reading, even if Content-Length is absent or false. */
export async function readBoundedBytes(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status}).`);
  const declared = response.headers.get("content-length");

  if (declared && Number(declared) > limit) {
    await response.body.cancel().catch(() => {});
    throw new Error("Download exceeds its declared limit.");
  }

  try {
    return await readBoundedStream(response.body, limit);
  } catch (error) {
    if (error instanceof StreamLimitError)
      throw new Error("Download exceeds its declared limit.");
    throw error;
  }
}

/** The share service rejected the account token; the stored login is stale. */
export class ShareAuthError extends Error {
  constructor() {
    super("The share service rejected the stored login.");
    this.name = "ShareAuthError";
  }
}

/** Account tokens go only to the configured API origin. */
export class ShareClient {
  private readonly origin: string;
  constructor(
    origin: string,
    private readonly token?: string,
    private readonly send: typeof fetch = fetch,
  ) {
    const url = new URL(origin);

    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && url.hostname === "localhost"))
    )
      throw new Error("Use a secure share service origin.");
    this.origin = url.origin;
  }

  private async api(
    route: string,
    method = "GET",
    body?: string,
    anonymous = false,
  ): Promise<JsonValue> {
    return parseJsonText(
      Buffer.from(
        await this.request(route, method, body, anonymous, MAX_RESPONSE_BYTES),
      ).toString(),
    );
  }

  private async request(
    route: string,
    method: string,
    body: string | undefined,
    anonymous: boolean,
    maxBytes: number,
  ) {
    const headers = new Headers({ "content-type": "application/json" });

    if (this.token && !anonymous)
      headers.set("authorization", `Bearer ${this.token}`);

    const init: RequestInit = {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(300_000),
      headers,
    };

    if (body !== undefined) init.body = body;
    const response = await this.send(this.origin + route, init);

    if (!response.ok) {
      await response.body?.cancel();

      if (response.status === 401 && !anonymous) throw new ShareAuthError();
      throw new Error(`Share request failed (${response.status}).`);
    }

    return readBoundedBytes(response, maxBytes);
  }

  async create(bundle: ShareBundle, requestId: string = randomUUID()) {
    return linkSchema.parse(
      await this.api(
        "/api/v2/shares",
        "POST",
        shareRequestBody(bundle, requestId),
      ),
    );
  }

  async list(cursor?: string) {
    const query = cursor ? `?cursor=${z.uuid().parse(cursor)}` : "";

    return this.api(`/api/v2/shares${query}`);
  }

  async recoverLink(shareId: string) {
    return linkSchema.parse(
      await this.api(`/api/v2/shares/${z.uuid().parse(shareId)}/link`),
    );
  }

  async revoke(shareId: string) {
    return this.api(`/api/v2/shares/${z.uuid().parse(shareId)}`, "DELETE");
  }

  /** The bundle and who shared it, read with the link's capability. */
  async download(capability: string) {
    const route = `/api/v2/shared/${capabilitySchema.parse(capability)}`;

    const received = receivedSchema.parse(
      await this.api(route, "GET", undefined, true),
    );

    const bytes = await this.request(
      `${route}/bundle`,
      "GET",
      undefined,
      true,
      MAX_SHARE_BYTES,
    );

    return {
      bundle: shareBundleSchema.parse(
        parseJsonText(new TextDecoder().decode(bytes)),
      ),
      attribution: {
        login: received.sender.login,
        sharedAt: received.sharedAt,
      },
    };
  }
}
