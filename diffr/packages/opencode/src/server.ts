import { Plugin } from "@opencode/plugin";
import { openDescription } from "@diffr/consumer/open-tool";
import { requestOpen } from "./bridge";
import { Diffr } from "./rpc";

export default Plugin.define({
  id: "diffr",
  async setup(ctx) {
    const rpc = await ctx.rpc.register(Diffr, {});
    await ctx.tool.transform(editor => editor.add({
      name: "diffr_open",
      description: openDescription,
      input: { type: "object", properties: { args: { type: "array", items: { type: "string" } } }, additionalProperties: false },
      options: { codemode: false },
      async execute(input, context) {
        const { args = [] } = input as { args?: string[] };
        const content = await requestOpen(command => rpc.events.emit("open", { command }), {
          sessionID: context.sessionID, directory: ctx.location.directory, args,
        }, context.signal);
        return { content };
      },
    }));
  },
});
