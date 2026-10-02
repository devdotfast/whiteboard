import { isInlineC4Expandable } from "./c4-projection";
import type { NormalizedSoftwareModel } from "./model";

export function softwareMapNavigationKey({
  title,
  view,
  placeholderLabel = "Software map",
}: {
  title?: string;
  view?: string;
  placeholderLabel?: string;
}) {
  return [title ?? "", view ?? "", placeholderLabel].join("\u001f");
}

export function softwareMapAncestorPaths(path: string): string[] {
  const parts = path.split(".");
  const ancestors: string[] = [];

  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join("."));
  }

  return ancestors;
}

export function initialSoftwareMapExpandedNodeIds(
  model: NormalizedSoftwareModel | null | undefined,
): Set<string> {
  return new Set(
    model?.elements
      .filter(
        (element) =>
          element.type !== "component" && isInlineC4Expandable(element),
      )
      .map((element) => element.path) ?? [],
  );
}

export function seedSoftwareMapDefaultExpandedNodeIds(input: {
  expandedNodeIds: ReadonlySet<string>;
  model: NormalizedSoftwareModel | null | undefined;
  defaultExpansionActive: boolean;
}): Set<string> {
  if (!input.defaultExpansionActive) {
    return new Set(input.expandedNodeIds);
  }

  const expandedNodeIds = new Set(input.expandedNodeIds);

  for (const path of initialSoftwareMapExpandedNodeIds(input.model)) {
    expandedNodeIds.add(path);
  }

  return expandedNodeIds;
}
