import { randomUUID } from "node:crypto";

import { type JsonValue, parseJsonText } from "@dev.fast/json";
import {
  MAX_SHARE_BYTES,
  type ShareBundle,
  type ShareRevisions,
  type SharedMeta,
  capabilitySchema,
  shareCreatedSchema,
  shareIdSchema,
  shareRevisionsSchema,
  sharedMetaSchema,
} from "@dev.fast/review-share-protocol";
import {
  StreamLimitError,
  readBoundedStream,
} from "@review/server/bounded-stream.js";
import { Agent } from "undici";
import { z } from "zod";

import { shareRequestBody } from "./export.js";
import {
  WHITEBOARD_UPGRADE_REQUIRED_MESSAGE,
  parseWhiteboardFile,
} from "./file.js";

const MAX_RESPONSE_BYTES = MAX_SHARE_BYTES;

// Uploads reuse the connection `warm` opens, skipping a cold Worker start.
const pool = new Agent({
  keepAliveTimeout: 5 * 60_000,
  keepAliveMaxTimeout: 5 * 60_000,
});

const pooledFetch: typeof fetch = (input, init) => {
  // Node's fetch reads `dispatcher`; the DOM type omits it.
  const pooled = { ...init, dispatcher: pool };

  return fetch(input, pooled);
};

const jwtSchema = z.object({ token: z.string().min(1) });

const jwtPayloadSchema = z.object({ exp: z.number() });

const bearers = new Map<string, Promise<{ bearer: string; until: number }>>();

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

export class ShareRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ShareRequestError";
  }
}

const errorSchema = z.object({ error: z.object({ code: z.string() }) });

async function requestError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const ray = response.headers.get("cf-ray");

  const reference =
    ray && /^[a-f0-9]{16}(?:-[a-z]{3})?$/i.test(ray)
      ? ` Reference: ${ray}.`
      : "";

  let code: string | undefined;

  if (contentType.includes("application/json") && response.body) {
    try {
      const bytes = await readBoundedStream(response.body, 16 * 1024);
      const parsed = errorSchema.safeParse(parseJsonText(bytes.toString()));

      if (parsed.success) code = parsed.data.error.code;
    } catch {
      // Error bodies are optional and never shown to the reader.
    }
  } else await response.body?.cancel();

  let message = `The sharing service refused this request (HTTP ${response.status}). Please report this issue.`;

  if (response.status === 426 || code === "upgrade_required")
    message = WHITEBOARD_UPGRADE_REQUIRED_MESSAGE;
  else if (
    response.status === 403 &&
    contentType.includes("text/html") &&
    response.headers.get("server")?.toLowerCase() === "cloudflare"
  )
    message =
      "The sharing service's security filter blocked this request. Please report this issue.";
  else if (response.status === 413)
    message =
      "This review is too large to share. Remove large resources, then retry.";
  else if (response.status === 429)
    message =
      code === "share_quota_exceeded"
        ? "Your sharing storage limit has been reached. Please contact support."
        : "Too many sharing requests. Wait a moment, then retry.";
  else if (response.status === 400 && code === "invalid_request")
    message =
      "The sharing service could not accept this review. Update Whiteboard or report this issue.";
  else if (response.status >= 500)
    message = `The sharing service is temporarily unavailable (HTTP ${response.status}). Try again shortly.`;

  return new ShareRequestError(response.status, message + reference);
}

/** Account tokens go only to the configured API origin. */
export class ShareClient {
  private readonly origin: string;
  constructor(
    origin: string,
    private readonly token?: string,
    private readonly send: typeof fetch = pooledFetch,
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
      headers.set("authorization", `Bearer ${await this.bearer(this.token)}`);

    const init: RequestInit = {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(300_000),
      headers,
    };

    if (body !== undefined) init.body = body;
    const response = await this.send(this.origin + route, init);

    if (!response.ok) {
      if (response.status === 401 && !anonymous) {
        await response.body?.cancel();
        throw new ShareAuthError();
      }

      throw await requestError(response);
    }

    return readBoundedBytes(response, maxBytes);
  }

  private async bearer(token: string): Promise<string> {
    const key = `${this.origin} ${token}`;
    const pending = bearers.get(key);

    if (pending) {
      const cached = await pending.catch(() => undefined);

      if (cached && cached.until > Date.now()) return cached.bearer;

      // Another caller already replaced the stale exchange.
      if (bearers.get(key) !== pending) return this.bearer(token);
    }

    // Stored before any await, so callers in the same tick share it.
    const next = this.exchange(token);
    bearers.set(key, next);

    return (await next).bearer;
  }

  private async exchange(token: string) {
    const response = await this.send(`${this.origin}/api/auth/token`, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      // A service without the JWT plugin still takes the device token.
      if (response.status === 404 || response.status === 405) {
        await response.body?.cancel();

        return { bearer: token, until: Date.now() + 10 * 60_000 };
      }

      if (response.status === 401) {
        await response.body?.cancel();
        throw new ShareAuthError();
      }

      throw await requestError(response);
    }

    const { token: jwt } = jwtSchema.parse(
      parseJsonText(
        Buffer.from(await readBoundedBytes(response, 64 * 1024)).toString(),
      ),
    );

    const { exp } = jwtPayloadSchema.parse(
      parseJsonText(
        Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString(),
      ),
    );

    return { bearer: jwt, until: exp * 1000 - 60_000 };
  }

  async warm() {
    if (this.token) await this.bearer(this.token);

    const response = await this.send(`${this.origin}/api/v2/shares`, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    await response.body?.cancel();
  }

  async create(bundle: ShareBundle, requestId: string = randomUUID()) {
    return shareCreatedSchema.parse(
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
    return shareCreatedSchema.parse(
      await this.api(`/api/v2/shares/${z.uuid().parse(shareId)}/link`),
    );
  }

  async revoke(shareId: string) {
    return this.api(`/api/v2/shares/${z.uuid().parse(shareId)}`, "DELETE");
  }

  async revisions(shareId: string): Promise<ShareRevisions> {
    return shareRevisionsSchema.parse(
      await this.api(
        `/api/v2/shares/${shareIdSchema.parse(shareId)}/revisions`,
      ),
    );
  }

  /** Who shared a link's revision, and which revision is its latest. */
  async shared(capability: string, revision?: string): Promise<SharedMeta> {
    const query =
      revision === undefined ? "" : `?rev=${shareIdSchema.parse(revision)}`;

    return sharedMetaSchema.parse(
      await this.api(
        `/api/v2/shared/${capabilitySchema.parse(capability)}${query}`,
        "GET",
        undefined,
        true,
      ),
    );
  }

  /** The bundle of the revision the meta names, and who shared it. */
  async download(capability: string, revision?: string) {
    const meta = await this.shared(capability, revision);

    const bytes = await this.request(
      `/api/v2/shared/${capability}/bundle?rev=${meta.revision.id}`,
      "GET",
      undefined,
      true,
      MAX_SHARE_BYTES,
    );

    return {
      bundle: parseWhiteboardFile(new TextDecoder().decode(bytes)),
      attribution: { login: meta.sender.login, sharedAt: meta.sharedAt },
      revision: meta.revision,
      latest: meta.latest,
    };
  }
}
