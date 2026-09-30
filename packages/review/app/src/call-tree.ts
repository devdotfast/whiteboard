import { frameIdentity } from "@review/call-stack-frames";
import {
  type DiffSelection,
  type LensSource,
  anchorSelection,
} from "@review/lens-selection";
import type { CallStackDiffBlock } from "@review/review-api/blocks/call_stack_diff";

export interface CallTreeStop {
  id: string;
  label: string;
  source: DiffSelection;
  anchorId: string;
  sources: LensSource[];
  parentId?: string;
  callSite?: DiffSelection;
  via?: string;
  depth: number;
  branches: boolean[];
  last: boolean;
}

/** Adapt authored frames to the experimental sidebar's presentation contract. */
export function callTreeStops(block: CallStackDiffBlock): CallTreeStop[] {
  const nodes = new Map<
    string,
    Omit<CallTreeStop, "depth" | "branches" | "last">
  >();

  for (const side of ["head", "base"] as const) {
    let previous: string | undefined;

    for (const [index, frame] of block[side].entries()) {
      const id = `${block.id}:${frame.key ?? `${side}:${index}`}`;
      const existing = nodes.get(id);

      const select = (anchor: string) =>
        anchorSelection(anchor, frame.pins ?? block.pins);

      const source = select(frame.source);
      const callSite = frame.callSite ? select(frame.callSite) : undefined;

      const sources = [
        source,
        ...(frame.contextSources ?? []).map(select),
        ...(callSite ? [callSite] : []),
      ];

      if (existing) existing.sources.push(...sources);
      else
        nodes.set(id, {
          id,
          source,
          anchorId: frame.id ?? frameIdentity(frame),
          label: frame.label ?? source.file.split("/").pop()!,
          sources,
          parentId:
            frame.parentKey === null
              ? undefined
              : frame.parentKey
                ? `${block.id}:${frame.parentKey}`
                : previous,
          callSite,
          via: frame.via?.reason,
        });
      previous = id;
    }
  }

  const result: CallTreeStop[] = [];

  const walk = (
    parentId: string | undefined,
    depth: number,
    branches: boolean[],
  ) => {
    const children = [...nodes.values()].filter(
      (node) => node.parentId === parentId,
    );

    children.forEach((node, index) => {
      const last = index === children.length - 1;
      result.push({ ...node, depth, branches, last });
      walk(node.id, depth + 1, [...branches, !last]);
    });
  };

  walk(undefined, 0, []);

  return result;
}
