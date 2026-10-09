import { Rpc } from "@opencode/plugin/rpc";

export const Diffr = Rpc.define({
  id: "diffr",
  methods: {},
  events: { open: { schema: {
    type: "object", properties: { command: { type: "string" } },
    required: ["command"], additionalProperties: false,
  } } },
});
