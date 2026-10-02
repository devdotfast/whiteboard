import { isStringValue } from "@dev.fast/review-protocol";
import type { Dispatch, SetStateAction } from "react";
import { z } from "zod";
import { persist } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import { reviewPersistence } from "./review-persistence";

const savedDiagram = z.object({
  modelKey: z.string().optional(),
  expandedNodeIds: z.array(z.string()),
  selectedNodeId: z.string().nullable(),
  expanded: z.boolean(),
});

type SavedDiagram = z.infer<typeof savedDiagram>;

interface DiagramNavigation {
  modelKey: string | undefined;
  expandedNodeIds: Set<string>;
  selectedNodeId: string | null;
  expanded: boolean;
  restored: boolean;
  setExpandedNodeIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
  setExpanded(expanded: boolean): void;
}

export type DiagramNavigationStore = ReturnType<
  typeof createDiagramNavigationStore
>;

export function createDiagramNavigationStore(
  key: string,
  modelKey: string | undefined,
  expandedNodeIds: Set<string>,
) {
  return createStore<DiagramNavigation>()(
    persist(
      (set) => ({
        modelKey,
        expandedNodeIds,
        selectedNodeId: null,
        expanded: false,
        restored: false,
        setExpandedNodeIds: (next) =>
          set((state) => ({
            expandedNodeIds:
              next instanceof Set ? next : next(state.expandedNodeIds),
          })),
        setSelectedNodeId: (next) =>
          set((state) => ({
            selectedNodeId:
              next === null || isStringValue(next)
                ? next
                : next(state.selectedNodeId),
          })),
        setExpanded: (expanded) => set({ expanded }),
      }),
      reviewPersistence<DiagramNavigation, SavedDiagram>({
        key,
        scope: "session",
        partialize: (state) => ({
          modelKey: state.modelKey,
          expandedNodeIds: [...state.expandedNodeIds],
          selectedNodeId: state.selectedNodeId,
          expanded: state.expanded,
        }),
        parse: (value) => {
          const saved = savedDiagram.safeParse(value).data;

          return saved?.modelKey === modelKey ? saved : undefined;
        },
        restore: (saved, current) => ({
          ...current,
          ...saved,
          expandedNodeIds: new Set(saved.expandedNodeIds),
          restored: true,
        }),
      }),
    ),
  );
}
