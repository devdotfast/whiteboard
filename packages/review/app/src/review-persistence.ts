import {
  type JsonValue,
  isJsonObject,
  jsonNumber,
  jsonValueSchema,
} from "@dev.fast/review-protocol";
import type { PersistOptions, PersistStorage } from "zustand/middleware";

import {
  type ReviewUiScope,
  readReviewUiState,
  removeReviewUiState,
  writeReviewUiState,
} from "./review-ui-state";

interface ReviewPersistence<T, Saved> {
  key: string;
  scope: ReviewUiScope;
  partialize(state: T): Saved;
  parse(value: JsonValue): Saved | undefined;
  restore?(saved: Saved, current: T): T;
  /** Existing unwrapped JSON at this key is read as version zero. */
  legacy?: boolean;
}

const VERSION = 1;

/** Persist only resumable data; validate it before it can enter a live store. */
export function reviewPersistence<T, Saved>({
  key,
  scope,
  partialize,
  parse,
  restore = (saved, current) => ({ ...current, ...saved }),
  legacy = false,
}: ReviewPersistence<T, Saved>): PersistOptions<T, unknown> {
  const storage: PersistStorage<unknown> = {
    getItem(name) {
      const value = readReviewUiState<JsonValue>(scope, name);

      if (value === null) return null;

      if (isJsonObject(value) && "state" in value) {
        const version = jsonNumber(value.version);

        return version === undefined ? null : { state: value.state, version };
      }

      return legacy ? { state: value, version: 0 } : null;
    },
    setItem: (name, value) => writeReviewUiState(scope, name, value),
    removeItem: (name) => removeReviewUiState(scope, name),
  };

  return {
    name: key,
    storage,
    version: VERSION,
    partialize,
    // Zustand rewrites storage after a migration and swallows a throw, so an
    // unreadable record is left in place rather than replaced by defaults.
    migrate: (value, previousVersion) => {
      const json = jsonValueSchema.parse(value);

      if (previousVersion !== 0 || !legacy || parse(json) === undefined) {
        throw new Error(`Unsupported UI state version: ${previousVersion}`);
      }

      return json;
    },
    merge: (value, current) => {
      const json = jsonValueSchema.safeParse(value);

      if (!json.success) return current;
      const saved = parse(json.data);

      return saved === undefined ? current : restore(saved, current);
    },
  };
}
