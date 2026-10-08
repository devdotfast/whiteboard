import { tool, type Plugin } from "@opencode-ai/plugin";
import { openDescription } from "@diffr/consumer/open-tool";
import { requestOpen } from "./bridge";

const server: Plugin = async ({ client }) => ({
  tool: {
    diffr_open: tool({
      description: openDescription,
      args: { args: tool.schema.array(tool.schema.string()).optional() },
      execute: async ({ args }, ctx) => requestOpen(command => client.tui.publish({
        body: { type: "tui.command.execute", properties: { command } }, query: { directory: ctx.directory }, throwOnError: true,
      }), { sessionID: ctx.sessionID, directory: ctx.directory, args: args ?? [] }, ctx.abort),
    }),
  },
});
export default server;
