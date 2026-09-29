import {
  healthyReviewInstance,
  reviewInstanceUnavailable,
  selectReviewInstance,
} from "@review/desktop-discovery.js";
import { desktopApplicationInstalled } from "@review/review-app-launcher.js";
import {
  readReviewServerDiscovery,
  reviewServerIsHealthy,
  reviewServerStateDir,
  serverNotReady,
} from "@review/server-discovery.js";

import { ReviewApiClient, ReviewApiError } from "./client.js";

export interface AuthoringTool {
  name: string;
  description: string;
  inputSchema: Tool["inputSchema"];
  method: "GET" | "POST";
  path: string;
  commandType?: string;
}

const TEXT_TOOLS = new Set([
  "review_get",
  "review_get_instructions",
  "session_get",
  "session_get_instructions",
]);

export interface ConnectedReview {
  client: ReviewApiClient;
  /** The Desktop reached; absent for a headless server. */
  instance?: { key: string };
}

export async function connectReviewApi(
  env = process.env,
  headers: Record<string, string> = {},
) {
  return (await connectReviewInstance(env, headers)).client;
}

export interface ConnectReviewOptions {
  /** The launcher's own check by default. */
  desktopInstalled?: () => boolean;
  /** The CLI that starts a background server; this process's by default. */
  cli?: readonly string[];
}

export async function connectReviewInstance(
  env = process.env,
  headers: Record<string, string> = {},
  options: ConnectReviewOptions = {},
): Promise<ConnectedReview> {
  const request: ConstructorParameters<typeof ReviewApiClient>[1] = (
    url,
    init,
  ) => {
    const merged = new Headers(init?.headers);

    for (const [key, value] of Object.entries(headers)) merged.set(key, value);

    return fetch(url, { ...init, headers: merged });
  };

  if (env.DEV_REVIEW_SERVER_DIR?.trim()) {
    const stateDir = reviewServerStateDir(env);
    const server = await readReviewServerDiscovery(stateDir);

    if (!server || !(await reviewServerIsHealthy(server)))
      throw serverNotReady(stateDir);

    return {
      client: new ReviewApiClient(
        { serverUrl: server.url, token: server.token },
        request,
      ),
    };
  }

  const selection = await selectReviewInstance({ env });
  const discovery = healthyReviewInstance(selection);

  // With no Desktop to start, the CLI keeps this machine's own server up.
  if (
    !discovery &&
    !(
      options.desktopInstalled ?? (() => desktopApplicationInstalled({ env }))
    )()
  ) {
    const { ensureBackgroundServer } =
      await import("@review/server/background-server.js");

    const { discovery: server } = await ensureBackgroundServer({
      stateDir: reviewServerStateDir(env),
      env,
      cli: options.cli,
    });

    return {
      client: new ReviewApiClient(
        { serverUrl: server.url, token: server.token },
        request,
      ),
    };
  }

  if (!discovery)
    throw new Error(
      `${reviewInstanceUnavailable(selection).message} For headless authoring, select a running server with --state-dir or DEV_REVIEW_SERVER_DIR.`,
    );

  return {
    client: new ReviewApiClient(
      { serverUrl: discovery.url, token: discovery.token },
      request,
    ),
    instance: { key: selection.key },
  };
}

/** Only translate the tool envelope. The host owns validation and persistence. */
export async function callAuthoringTool(
  client: ReviewApiClient,
  tool: AuthoringTool,
  input: NonNullable<CallToolRequest["params"]["arguments"]>,
  signal?: AbortSignal,
) {
  if (tool.commandType) {
    // Agents may omit the id; the host's receipts make a retry with it safe.
    const { commandId = randomUUID(), leaseId, ...fields } = input;

    try {
      return await client.post<JsonValue>(
        tool.path,
        {
          commandId,
          leaseId,
          operation: { ...fields, type: tool.commandType },
        },
        signal,
      );
    } catch (error) {
      // A host reply (any status) is definite: a failed command rolls back.
      if (error instanceof ReviewApiError || signal?.aborted) throw error;

      throw new Error(
        `Whiteboard may or may not have applied ${tool.name} (${error instanceof Error ? error.message : String(error)}). Retry with identical input, including leaseId, and commandId "${String(commandId)}": if the first attempt was applied, you get its result back instead of a second write.`,
        { cause: error },
      );
    }
  }

  const fields = { ...input };

  const route = tool.path.replace(/:reviewId\b/g, () => {
    const value = fields.reviewId;

    if (!isStringValue(value) || !value)
      throw new Error("reviewId is required.");
    delete fields.reviewId;

    return encodeURIComponent(value);
  });

  if (tool.method === "POST")
    return client.post<JsonValue>(route, fields, signal);
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(fields)) {
    // Hosts often send null for an unused optional field; the route reads absence.
    if (value === null || value === undefined) continue;

    // Arrays travel as repeated keys, as in paths=a&paths=b.
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!isStringValue(item) && !isNumberValue(item) && !isBooleanValue(item))
        throw new Error(
          `${key} must be a string, number, boolean or list of them.`,
        );

      query.append(key, String(item));
    }
  }

  const response = await client.response(
    route + (query.size ? `?${query}` : ""),
    { signal },
  );

  return response.headers.get("content-type")?.startsWith("text/plain")
    ? new ToolText(await response.text())
    : parseJsonText(await response.text());
}

/** A plain-text reply, shown to the agent as-is instead of as a JSON string. */
export class ToolText {
  constructor(readonly text: string) {}
}

/** The text an agent sees for a tool result. */
export function toolResultText(
  tool: Pick<AuthoringTool, "name">,
  result: JsonValue | ToolText,
) {
  if (result instanceof ToolText) return result.text;

  return TEXT_TOOLS.has(tool.name) && isStringValue(result)
    ? result
    : JSON.stringify(result);
}

import { randomUUID } from "node:crypto";

import {
  isBooleanValue,
  isNumberValue,
  isStringValue,
  type JsonValue,
  parseJsonText,
} from "@dev.fast/json";
import type { CallToolRequest, Tool } from "@modelcontextprotocol/sdk/types.js";
