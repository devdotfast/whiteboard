import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const reply = (id, result) => send({ jsonrpc: "2.0", id, result });

const notify = (method, params) => send({ jsonrpc: "2.0", method, params });

const cwds = new Map();

let toolCalls = 0;

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;

  const { id, method, params } = JSON.parse(line);

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { image: false },
        },
        authMethods: [],
      });
    case "session/new": {
      const sessionId = `wb-test-${cwds.size + 1}`;

      cwds.set(sessionId, params.cwd);

      return reply(id, {
        sessionId,
        modes: {
          currentModeId: "build",
          availableModes: [
            { id: "build", name: "Build" },
            { id: "plan", name: "Plan" },
          ],
        },
      });
    }

    case "session/set_mode":
      return reply(id, {});
    case "session/prompt": {
      const { sessionId, prompt } = params;
      const question = prompt.findLast((block) => block.type === "text")?.text;

      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `You asked: ${question}. See f.ts.` },
        },
      });
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: `t${++toolCalls}`,
          title: "Read f.ts",
          kind: "read",
          status: "completed",
          locations: [{ path: `${cwds.get(sessionId)}/f.ts`, line: 1 }],
        },
      });

      return reply(id, { stopReason: "end_turn" });
    }

    case "session/cancel":
      return;
    default:
      if (id !== undefined)
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `unknown method ${method}` },
        });
  }
});
