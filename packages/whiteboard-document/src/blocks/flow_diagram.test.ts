import { describe, expect, it } from "vitest";
import { z } from "zod";

import { flowNodeKinds, flowNodeSchema } from "./flow_diagram.js";

describe("flow_node kind", () => {
  const node = { key: "a", label: "A" };

  it.each(flowNodeKinds)("accepts %s", (kind) => {
    expect(flowNodeSchema.parse({ ...node, kind }).kind).toBe(kind);
  });

  it("stays optional, so a node without a kind parses as it always has", () => {
    expect(flowNodeSchema.parse(node).kind).toBeUndefined();
  });

  it("rejects a kind it does not know", () => {
    expect(() => flowNodeSchema.parse({ ...node, kind: "server" })).toThrow(
      z.ZodError,
    );
  });
});
