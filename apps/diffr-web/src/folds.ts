/**
 * The fold sets the diffr TUI's commands act on (diffr/tui/packages/hunk/src/diffr/regions.ts):
 * everything foldable, what a fold holds, and the context gaps. Only fold-state ids: the session
 * keeps whether each is collapsed.
 */
import type {
  StructuralRegion,
  StructuralTextDiff,
} from "./review/common/reviewStructuralDiff.js";

type Region = StructuralRegion;

/** Each side's regions under its root, depth first. */
function regions(diff: StructuralTextDiff): Region[][] {
  return [diff.lhs, diff.rhs].map((side) => {
    const out: Region[] = [];

    const walk = (region: Region) => {
      out.push(region);

      if (region.kind === "fold") region.children.forEach(walk);
    };

    if (side?.root.kind === "fold") side.root.children.forEach(walk);

    return out;
  });
}

/** Every fold, and every leaf diffr collapsed or labelled: what fold all and unfold all touch. */
export function foldIds(diff: StructuralTextDiff): number[] {
  const ids = regions(diff)
    .flat()
    .filter(
      (region) =>
        region.kind === "fold" ||
        region.visibility?.collapsed === true ||
        !!region.visibility?.label,
    )
    .map((region) => region.fold_state_id);

  return [...new Set(ids)];
}

/** The folds inside every region sharing `id`, so a docstring and its function open as one. */
export function nestedIds(diff: StructuralTextDiff, id: number): number[] {
  const nested = new Set<number>();

  const collect = (region: Region) => {
    nested.add(region.fold_state_id);

    if (region.kind === "fold") region.children.forEach(collect);
  };

  for (const region of regions(diff).flat())
    if (region.fold_state_id === id && region.kind === "fold")
      region.children.forEach(collect);
  nested.delete(id);

  return [...nested].filter((n) => foldIds(diff).includes(n));
}

/**
 * Context gaps: what diffr collapsed far from any change. A region that starts collapsed, has no
 * tags, has a counterpart on the other side, and holds no change on either side.
 */
export function gapIds(diff: StructuralTextDiff): number[] {
  const sides = regions(diff);

  const leaves = sides.map((side) =>
    side.filter(
      (region): region is Extract<Region, { kind: "leaf" }> =>
        region.kind === "leaf",
    ),
  );

  const states = sides.map(
    (side) => new Set(side.map((region) => region.fold_state_id)),
  );

  const alignments = leaves.map(
    (side) => new Set(side.map((leaf) => leaf.alignment_id)),
  );

  const changed = new Set(
    leaves
      .flat()
      .filter((leaf) => leaf.changed?.length)
      .map((leaf) => leaf.alignment_id),
  );

  const gaps = new Set<number>();

  sides.forEach((side, index) => {
    const other = index ? 0 : 1;

    const paired = (region: Region) =>
      region.kind === "leaf"
        ? alignments[other]!.has(region.alignment_id)
        : states[other]!.has(region.fold_state_id);

    const unchanged = (region: Region): boolean =>
      region.kind === "leaf"
        ? paired(region) && !changed.has(region.alignment_id)
        : region.children.every(unchanged);

    for (const region of side)
      if (
        region.visibility?.collapsed === true &&
        !region.tags?.length &&
        paired(region) &&
        unchanged(region)
      )
        gaps.add(region.fold_state_id);
  });

  return [...gaps];
}
