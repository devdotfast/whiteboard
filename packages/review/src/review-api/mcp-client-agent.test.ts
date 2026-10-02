import { expect, it } from "vitest";

import { mcpClientAgent } from "./mcp-client-agent.js";

it("names the agent from the client name each connected agent sends", () => {
  expect(mcpClientAgent("claude-code")).toBe("claude");
  expect(mcpClientAgent("codex-mcp-client")).toBe("codex");
  expect(mcpClientAgent("Cursor")).toBe("cursor");
  expect(mcpClientAgent("opencode")).toBe("opencode");
  expect(mcpClientAgent("pi")).toBe("pi");
  expect(mcpClientAgent("omp-coding-agent")).toBe("omp");
});

it("leaves an unknown client to the environment", () => {
  expect(mcpClientAgent("Visual Studio Code")).toBeUndefined();
  expect(mcpClientAgent("pilot")).toBeUndefined();
  expect(mcpClientAgent(undefined)).toBeUndefined();
});
