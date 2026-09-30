import { describe, expect, it } from "vitest";

import {
  type CallStackEntry,
  type PeekableAnchorRef,
  callStackDiffPropsSchema,
  calls,
  codePeekSource,
} from "./authoring";
import { callStackEvidenceErrors, diffCallStacks } from "./call-stack-diff";
import { callStackFrames } from "./call-stack-frames";
import { selectSource } from "./lens-selection";

interface AnchorPeekProps {
  file: string;
  fromLine: number;
  toLine: number;
  graph?: "base" | "head";
}

function anchor(id: string, graph?: "base" | "head"): PeekableAnchorRef {
  const props: AnchorPeekProps = {
    file: `src/${id}.ts`,
    fromLine: 1,
    toLine: 5,
  };

  if (graph !== undefined) props.graph = graph;

  return Object.freeze({
    __kind: "db-anchor-ref",
    id,
    title: `Anchor ${id}`,
    peek: selectSource(codePeekSource(props)),
  }) as PeekableAnchorRef;
}

const reconcile = anchor("reconcile");

const auth = anchor("auth", "base");

const enqueueWork = anchor("enqueueWork");

const processItem = anchor("processItem");

const persistResult = anchor("persistResult");

const diff = (base: CallStackEntry[], head: CallStackEntry[]) =>
  diffCallStacks(callStackFrames(base), callStackFrames(head));

describe("diffCallStacks", () => {
  it("aligns shared frames and marks removed and added frames", () => {
    const rows = diff(
      [reconcile, auth, enqueueWork, persistResult],
      [reconcile, enqueueWork, processItem, persistResult],
    );

    expect(rows.map((row) => [row.change, row.frame.id])).toEqual([
      ["unchanged", "reconcile"],
      ["removed", "auth"],
      ["unchanged", "enqueueWork"],
      ["added", "processItem"],
      ["unchanged", "persistResult"],
    ]);
  });

  it("matches a calls() hop by its child frame", () => {
    const hop = calls(enqueueWork, processItem, "via the workqueue");
    const rows = diff([enqueueWork, hop], [enqueueWork, hop]);
    expect(rows.map((row) => row.change)).toEqual(["unchanged", "unchanged"]);
  });

  it("diffs one-sided stacks", () => {
    expect(diff([], [reconcile]).map((row) => row.change)).toEqual(["added"]);
    expect(diff([auth], []).map((row) => row.change)).toEqual(["removed"]);
  });

  it("assigns each row its own side's depth", () => {
    const rows = diff(
      [reconcile, auth, enqueueWork],
      [reconcile, enqueueWork, processItem],
    );

    expect(rows.map((row) => [row.change, row.depth])).toEqual([
      ["unchanged", 0],
      ["removed", 1],
      ["unchanged", 1],
      ["added", 2],
    ]);
  });
});

describe("callStackDiffPropsSchema side rules", () => {
  it("accepts the canonical shape", () => {
    const result = callStackDiffPropsSchema.safeParse({
      title: "Warm allocation",
      base: [reconcile, auth, enqueueWork],
      head: [reconcile, enqueueWork, processItem],
      children: undefined,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a base-graph anchor in the head list", () => {
    const result = callStackDiffPropsSchema.safeParse({
      base: [],
      head: [auth],
      children: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("points at base");
  });

  it("rejects a head-graph anchor that is base-only", () => {
    const result = callStackDiffPropsSchema.safeParse({
      base: [reconcile],
      head: [enqueueWork],
      children: undefined,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("removed frame");
  });

  it("rejects an empty component", () => {
    const result = callStackDiffPropsSchema.safeParse({
      base: [],
      head: [],
      children: undefined,
    });

    expect(result.success).toBe(false);
  });
});

describe("callStackEvidenceErrors", () => {
  const changed = (file: string) =>
    file === "src/auth.ts"
      ? { deleted: new Set([2]), added: new Set<number>() }
      : file === "src/processItem.ts"
        ? { deleted: new Set<number>(), added: new Set([3]) }
        : null;

  it("accepts markers whose ranges intersect the change", () => {
    const rows = diff([reconcile, auth], [reconcile, processItem]);
    expect(callStackEvidenceErrors(rows, changed)).toEqual([]);
  });

  it("rejects a removed frame over unchanged code", () => {
    const rows = diff([reconcile, enqueueWork], [reconcile]);
    const errors = callStackEvidenceErrors(rows, changed);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"enqueueWork" renders "-"');
    expect(errors[0]).toContain("no deleted lines");
  });

  it("rejects an added frame over unchanged code", () => {
    const rows = diff([reconcile], [reconcile, persistResult]);
    const errors = callStackEvidenceErrors(rows, changed);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"persistResult" renders "+"');
    expect(errors[0]).toContain("no added lines");
  });
});
