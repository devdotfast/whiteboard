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
  version: number;
  partialize(state: T): Saved;
  parse(value: JsonValue): Saved | undefined;
  restore?(saved: Saved, current: T): T;
  migrate?(value: JsonValue, version: number): JsonValue;
  /** Existing unwrapped JSON at this key is treated as version zero. */
  legacy?: boolean;
  legacyScope?: ReviewUiScope;
}

/** Persist only resumable data; validate it before it can enter a live store. */
export function reviewPersistence<T, Saved>({
  key,
  scope,
  version,
  partialize,
  parse,
  restore = (saved, current) => ({ ...current, ...saved }),
  migrate,
  legacy = false,
  legacyScope,
}: ReviewPersistence<T, Saved>): PersistOptions<T, unknown> {
  const storage: PersistStorage<unknown> = {
    getItem(name) {
      const value =
        readReviewUiState<JsonValue>(scope, name) ??
        (legacyScope ? readReviewUiState<JsonValue>(legacyScope, name) : null);

      if (value === null) return null;

      if (isJsonObject(value) && "state" in value) {
        const storedVersion = jsonNumber(value.version);

        if (
          storedVersion === undefined ||
          !Number.isInteger(storedVersion) ||
          storedVersion < 0
        ) {
          return null;
        }

        return { state: value.state, version: storedVersion };
      }

      return legacy ? { state: value, version: 0 } : null;
    },
    setItem: (name, value) => writeReviewUiState(scope, name, value),
    removeItem: (name) => {
      removeReviewUiState(scope, name);

      if (legacyScope) removeReviewUiState(legacyScope, name);
    },
  };

  return {
    name: key,
    storage,
    version,
    partialize,
    migrate: (value, previousVersion) => {
      if (
        previousVersion > version ||
        (!migrate && !(legacy && previousVersion === 0))
      ) {
        throw new Error(`Unsupported UI state version: ${previousVersion}`);
      }

      const json = jsonValueSchema.parse(value);
      const migrated = migrate ? migrate(json, previousVersion) : json;

      if (parse(migrated) === undefined)
        throw new Error("Invalid persisted UI state");

      return migrated;
    },
    merge: (value, current) => {
      const json = jsonValueSchema.safeParse(value);

      if (!json.success) return current;
      const saved = parse(json.data);

      return saved === undefined ? current : restore(saved, current);
    },
  };
}
