import { z } from "zod";
import { persist } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import { reviewPersistence } from "./review-persistence";

interface DatabaseLensState {
  activeUseCaseId: string | null;
  setActiveUseCaseId(id: string): void;
}

const savedUseCase = z.object({ activeUseCaseId: z.string().nullable() });

export function createDatabaseLensStore(
  key: string,
  useCaseIds: readonly string[],
) {
  return createStore<DatabaseLensState>()(
    persist(
      (set) => ({
        activeUseCaseId: useCaseIds[0] ?? null,
        setActiveUseCaseId: (activeUseCaseId) => set({ activeUseCaseId }),
      }),
      reviewPersistence<DatabaseLensState, z.infer<typeof savedUseCase>>({
        key,
        scope: "session",
        partialize: ({ activeUseCaseId }) => ({ activeUseCaseId }),
        parse: (value) => {
          const saved = savedUseCase.safeParse(value).data;

          return saved?.activeUseCaseId &&
            useCaseIds.includes(saved.activeUseCaseId)
            ? saved
            : undefined;
        },
      }),
    ),
  );
}
