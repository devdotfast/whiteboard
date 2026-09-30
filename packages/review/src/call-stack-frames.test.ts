import { describe, expect, it } from "vitest";

import { type PeekableAnchorRef, calls } from "./authoring";
import { callStackFrames, frameIdentity } from "./call-stack-frames";
import { selectSource } from "./lens-selection";

const anchor = (id: string): PeekableAnchorRef => ({
  __kind: "db-anchor-ref",
  id,
  title: `Anchor ${id}`,
  peek: selectSource({
    side: "head",
    file: `src/${id}.ts`,
    fromLine: 1,
    toLine: 5,
  }),
});

describe("callStackFrames", () => {
  it("turns anchors into frames keyed by anchor id", () => {
    expect(callStackFrames([anchor("reconcile")])).toEqual([
      {
        id: "reconcile",
        key: "reconcile",
        source: "head/src/reconcile.ts#L1-L5",
        label: "Anchor reconcile",
      },
    ]);
  });

  it("turns a calls() hop into its child frame with the relationship", () => {
    const [withReason, withoutReason] = callStackFrames([
      calls(anchor("enqueue"), anchor("process"), "via the workqueue"),
      calls(anchor("process"), anchor("persist")),
    ]);

    expect(withReason).toMatchObject({
      id: "process",
      via: { kind: "call", reason: "via the workqueue" },
    });
    expect(withoutReason).toMatchObject({
      id: "persist",
      via: { kind: "call", reason: "asserted" },
    });
  });
});

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
