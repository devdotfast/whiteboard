import { describe, expect, it } from "vitest";

import { frameIdentity } from "./call-stack-frames";

describe("frame identity", () => {
  it("prefers the explicit key and falls back to the source range", () => {
    const source = "head/src/a.ts#L3-L4";

    expect(frameIdentity({ id: "x", key: "moved", source })).toBe("moved");
    expect(frameIdentity({ id: "x", source })).toBe(frameIdentity({ source }));
    expect(frameIdentity({ source })).not.toBe(
      frameIdentity({ source: "head/src/a.ts#L3-L5" }),
    );
  });
});
