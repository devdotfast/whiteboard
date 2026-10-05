import type { ReviewSessionAgent } from "@review/ui-telemetry-events.js";

/**
 * The agent behind an MCP client, from the name it sends in `initialize`.
 * Names seen on 2026-10-02: Claude Code `claude-code`, Codex
 * `codex-mcp-client`, the Cursor CLI `Cursor`, OpenCode `opencode`, Pi `pi`
 * and Oh My Pi `omp-coding-agent`. Undefined for
 * a client this does not recognize, so the caller can fall back to the
 * session environment. Codex strips its `CODEX_*` variables from the MCP
 * server's environment, so for Codex the handshake is the only signal.
 */
export function mcpClientAgent(
  name: string | undefined,
): ReviewSessionAgent | undefined {
  const normalized = name?.trim().toLowerCase();

  if (!normalized) return undefined;

  if (normalized.startsWith("codex")) return "codex";

  if (normalized.startsWith("claude")) return "claude";

  if (normalized.startsWith("cursor")) return "cursor";

  if (normalized.startsWith("opencode")) return "opencode";

  if (/^omp(?:$|[-_ ])/.test(normalized)) return "omp";

  if (/^pi(?:$|[-_ ])/.test(normalized)) return "pi";

  return undefined;
}
