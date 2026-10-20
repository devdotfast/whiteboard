import { useCallback } from "react";
import { create } from "zustand";

import { reviewPreferenceKey } from "./host/review-client";
import { readReviewUiState, writeReviewUiState } from "./review-ui-state";

const useExpansion = create<{ revision: number }>(() => ({ revision: 0 }));

const keyFor = (projectId?: string) =>
  reviewPreferenceKey("whiteboards-expanded", projectId ?? "unassigned");

const expanded = (projectId?: string) =>
  new Set(readReviewUiState<string[]>("reader", keyFor(projectId)) ?? []);

const collapsedKey = (projectId?: string) =>
  reviewPreferenceKey("whiteboards-collapsed", projectId ?? "unassigned");

function isExpanded(
  projectId: string | undefined,
  parentId: string,
  fallback = false,
) {
  return (
    expanded(projectId).has(parentId) ||
    (fallback &&
      !(
        readReviewUiState<string[]>("reader", collapsedKey(projectId)) ?? []
      ).includes(parentId))
  );
}

function setExpanded(
  projectId: string | undefined,
  parentId: string,
  value: boolean,
) {
  const ids = expanded(projectId);

  const collapsed = new Set(
    readReviewUiState<string[]>("reader", collapsedKey(projectId)) ?? [],
  );

  if (ids.has(parentId) === value && collapsed.has(parentId) === !value) return;

  if (value) ids.add(parentId);
  else ids.delete(parentId);

  if (value) collapsed.delete(parentId);
  else collapsed.add(parentId);
  writeReviewUiState("reader", keyFor(projectId), [...ids]);
  writeReviewUiState("reader", collapsedKey(projectId), [...collapsed]);
  useExpansion.setState((state) => ({ revision: state.revision + 1 }));
}

/** Both Home and the sidebar read the same per-project preference. */
export function useWhiteboardExpansion() {
  useExpansion((state) => state.revision);

  return { expanded, isExpanded, setExpanded };
}

export function useExpandedParents(
  projectId?: string,
): [ReadonlySet<string>, (parentId: string, value: boolean) => void] {
  useWhiteboardExpansion();

  const update = useCallback(
    (parentId: string, value: boolean) =>
      setExpanded(projectId, parentId, value),
    [projectId],
  );

  return [expanded(projectId), update];
}
