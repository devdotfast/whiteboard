import { Rpc } from "@opencode/plugin/rpc";

/** The local reply socket still provides cancellation and one-terminal acknowledgement. */
export const Diffr = Rpc.define({
  id: "diffr",
  methods: {},
  events: { open: { schema: {
    type: "object", properties: { command: { type: "string" } },
    required: ["command"], additionalProperties: false,
  } } },
});
