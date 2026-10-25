import type { Readable, Writable } from "node:stream";

import { type JsonValue, isJsonObject } from "@dev.fast/json";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ReviewToolCall } from "@review/review-telemetry.js";
import type { ReviewSessionAgent } from "@review/ui-telemetry-events.js";

import {
  type AuthoringTool,
  type ConnectedReview,
  ToolText,
  toolResultText,
} from "./agent-client.js";
import { authoringTools } from "./authoring-tools.js";
import type { ReviewApiClient } from "./client.js";
import { ReviewApiError } from "./client.js";
import { ReviewInputError } from "./input-error.js";
import { mcpClientAgent } from "./mcp-client-agent.js";
import { callPublicTool, publicTool } from "./public-tools.js";
import { RECOVERY } from "./recovery.js";
import { REVIEW_STATUS_TOOL } from "./status-tool.js";
import { type ToolFailure, toolFailure } from "./tool-failure.js";

// Some hosts ignore tools/list_changed, so the agent itself has to reload.
const RELOAD_TOOLS =
  "Whiteboard is running now, but this session listed Whiteboard's tools before it started, so you may see only session_get_instructions. Before authoring, reload the `whiteboard` MCP server's tools (reconnect it in your agent, or start a new agent session). If you can already see tools such as session_create, carry on.";

function mcpAuthoringGuidance(context: { traceEnabled: boolean }): string {
  return [
    "Whiteboard explains code in documents the user reads in Whiteboard Desktop. Call session_get_instructions before creating or editing a Whiteboard and follow it. Read session_capabilities before authoring; session_create opens the new review in Desktop when it is available, so call session_open only for an existing review, and generate software maps only when softwareMapEnabled is true. When the user asks for a Whiteboard or to use Whiteboard (for example to plan work, review a branch or PR stack, or explain a system in Whiteboard), author a Whiteboard with the default topic.",
    ...(context.traceEnabled
      ? [
          'For why code exists, what an agent was thinking, or whether an agent solved something before, call session_get_instructions({topic:"trace-archaeology"}).',
        ]
      : []),
    "For programmatic MCP calls, use structuredContent when present; otherwise parse JSON from the text content when the result is JSON. An insert through session_edit uses edit.content for the actual document component, never the MCP transport wrapper containing content or structuredContent.",
    "Never read or write Whiteboard files or SQL.",
  ].join(" ");
}

export async function serveReviewMcp(
  /** Connects to `key` once one is latched, else selects one, as `agentKind`. */
  connect: (
    key?: string,
    agentKind?: ReviewSessionAgent,
  ) => Promise<ConnectedReview>,
  stdin: Readable,
  stdout: Writable,
  stderr: Writable = process.stderr,
  traceEnabled = false,
  /** What whiteboard_status reports when the Desktop cannot be reached, and why. */
  offlineStatus?: (problem: string) => Promise<JsonValue>,
  onToolCall?: (call: ReviewToolCall) => Promise<void> | void,
  /** The agent from the session environment, when the handshake names none. */
  environmentAgent?: ReviewSessionAgent,
) {
  const instructionsTool = {
    ...authoringTools(traceEnabled).find(
      (tool) => tool.name === "review_get_instructions",
    )!,
    name: "session_get_instructions",
  };

  const server = new Server(
    { name: "whiteboard", version: "1.0.0" },
    {
      capabilities: { tools: { listChanged: true } },
    },
  );

  // Hosts list tools once, right after initialize, often before Desktop is up.
  // Answer from the last catalog (or none) instead of failing, and announce a
  // changed list once the host can be reached.
  let catalog: AuthoringTool[] = [];
  let announceCatalog = false;
  let listedWhileDown = false;
  // One session follows one instance key, through that Desktop's restarts;
  // it never hops to another key once others start.
  let latched: string | undefined;

  const agentKind = () =>
    mcpClientAgent(server.getClientVersion()?.name) ?? environmentAgent;

  const load = async (signal?: AbortSignal) => {
    const { client, instance } = await connect(latched, agentKind());
    latched ??= instance?.key;

    catalog = (await client.read<AuthoringTool[]>("/authoring", signal)).map(
      publicTool,
    );

    if (announceCatalog) {
      announceCatalog = false;
      void server.sendToolListChanged().catch(() => {});
    }

    return { client, tools: catalog };
  };

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    let tools = catalog;

    try {
      ({ tools } = await load(extra.signal));
      listedWhileDown = false;
    } catch (error) {
      announceCatalog = true;
      listedWhileDown = true;
      stderr.write(
        `whiteboard mcp: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }

    const always = [instructionsTool, REVIEW_STATUS_TOOL].map(
      (fallback) =>
        tools.find((tool) => tool.name === fallback.name) ?? fallback,
    );

    return {
      tools: [...always, ...tools.filter((tool) => !always.includes(tool))].map(
        ({ name, description, inputSchema, method }) => ({
          name,
          // Some clients prepend server instructions to every tool. Keep shared
          // guidance on the discovery tool instead, including before Desktop starts.
          description:
            name === instructionsTool.name
              ? `${mcpAuthoringGuidance({ traceEnabled })}\n\n${description}`
              : description,
          inputSchema,
          // GET routes only read.
          ...(method === "GET" && { annotations: { readOnlyHint: true } }),
        }),
      ),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const startedAt = Date.now();
    // The requested name is agent input; only a catalog name is reported.
    let tool: AuthoringTool | undefined;

    let phase: "connect" | "call" = "connect";

    const report = (failure?: ToolFailure) =>
      void onToolCall?.({
        tool: tool?.name ?? "other",
        via: "mcp",
        ok: !failure,
        durationMs: Date.now() - startedAt,
        agentKind: agentKind(),
        ...failure,
      });

    try {
      let client: ReviewApiClient;
      let tools: AuthoringTool[];

      try {
        ({ client, tools } = await load(extra.signal));
      } catch (error) {
        announceCatalog = true;

        if (
          request.params.name === instructionsTool.name &&
          !(error instanceof ReviewApiError)
        )
          return { content: [{ type: "text" as const, text: RECOVERY }] };

        if (request.params.name === REVIEW_STATUS_TOOL.name && offlineStatus) {
          const result = await offlineStatus(
            error instanceof Error ? error.message : String(error),
          );

          const response: CallToolResult = {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };

          if (isJsonObject(result)) response.structuredContent = result;

          return response;
        }

        throw error;
      }

      phase = "call";
      tool = tools.find((tool) => tool.name === request.params.name);

      if (!tool)
        throw new ReviewInputError(
          `Unknown Whiteboard tool: ${request.params.name}`,
        );

      const result = await callPublicTool(
        client,
        tool,
        request.params.arguments ?? {},
        extra.signal,
      );

      const text = toolResultText(tool, result);
      report();

      const response: CallToolResult = {
        content: [
          {
            type: "text",
            text:
              listedWhileDown && tool.name === instructionsTool.name
                ? `${RELOAD_TOOLS}\n\n${text}`
                : text,
          },
        ],
      };

      if (!(result instanceof ToolText) && isJsonObject(result))
        response.structuredContent = result;

      return response;
    } catch (error) {
      report(toolFailure(error, phase));

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  });
  await server.connect(new StdioServerTransport(stdin, stdout));

  return server;
}
