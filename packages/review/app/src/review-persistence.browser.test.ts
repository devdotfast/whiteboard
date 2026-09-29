import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { persist } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import { createReviewFindStore } from "./review-find-store";
import { reviewPersistence } from "./review-persistence";
import { TEST_REVIEW_CONFIG } from "./review-session-test-utils";
import { type ReviewUiScope, reviewUiStateKey } from "./review-ui-state";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const savedSchema = z.object({ selected: z.string() });

interface State {
  selected: string;
  busy: boolean;
  select(value: string): void;
}

function createSelection(key = "selection", scope: ReviewUiScope = "session") {
  return createStore<State>()(
    persist(
      (set) => ({
        selected: "default",
        busy: false,
        select: (selected) => set({ selected }),
      }),
      reviewPersistence<State, { selected: string }>({
        key,
        scope,
        legacy: true,
        partialize: ({ selected }) => ({ selected }),
        parse: (value) => savedSchema.safeParse(value).data,
      }),
    ),
  );
}

it("hydrates deliberate selections synchronously without restoring transient state", () => {
  const first = createSelection();
  expect(localStorage.getItem("selection")).toBeNull();
  first.getState().select("file.ts");
  first.setState({ busy: true });

  const restored = createSelection();
  expect(restored.getState().selected).toBe("file.ts");
  expect(restored.getState().busy).toBe(false);
  restored.getState().select("other.ts");
  expect(createSelection().getState().selected).toBe("other.ts");
});

it("does not write unchanged persisted fields on transient updates", () => {
  const store = createSelection();
  store.getState().select("file.ts");
  const write = vi.spyOn(Storage.prototype, "setItem");

  try {
    store.setState({ busy: true });
    store.setState({ busy: false });
    expect(write).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
  }
});

it("migrates legacy JSON and ignores malformed and future records", () => {
  localStorage.setItem("selection", JSON.stringify({ selected: "old.ts" }));
  expect(createSelection().getState().selected).toBe("old.ts");
  expect(JSON.parse(localStorage.getItem("selection")!)).toEqual({
    state: { selected: "old.ts" },
    version: 1,
  });

  for (const raw of [
    "{",
    JSON.stringify({ state: { selected: 42 }, version: 1 }),
    JSON.stringify({ state: { selected: "future.ts" }, version: 2 }),
    JSON.stringify({ state: { selected: "invalid.ts" }, version: "1" }),
  ]) {
    localStorage.setItem("selection", raw);
    expect(createSelection().getState().selected).toBe("default");
    expect(localStorage.getItem("selection")).toBe(raw);
  }
});

it("keeps window state temporary and review state durable and isolated", () => {
  createSelection("review-a").getState().select("a.ts");
  createSelection("review-b").getState().select("b.ts");
  createSelection("temporary", "window").getState().select("temp.ts");
  sessionStorage.clear();

  expect(createSelection("review-a").getState().selected).toBe("a.ts");
  expect(createSelection("review-b").getState().selected).toBe("b.ts");
  expect(createSelection("temporary", "window").getState().selected).toBe(
    "default",
  );
  const first = createSelection("review-a");
  first.persist.clearStorage();
  expect(createSelection("review-a").getState().selected).toBe("default");
  first.getState().select("a.ts");
  expect(createSelection("review-a").getState().selected).toBe("a.ts");
});

it("keeps actions usable when storage is unavailable or full", () => {
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });

  let store: ReturnType<typeof createSelection>;

  try {
    store = createSelection();
    store.getState().select("in-memory.ts");
    expect(store.getState().selected).toBe("in-memory.ts");
  } finally {
    read.mockRestore();
  }

  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });

  try {
    store.getState().select("still-usable.ts");
    expect(store.getState().selected).toBe("still-usable.ts");
  } finally {
    write.mockRestore();
  }
});

it("restores find inputs per review, leaving matches and handles transient", () => {
  const first = createReviewFindStore(TEST_REVIEW_CONFIG);
  first.getState().show("Alpha");
  first.getState().toggleOption("matchCase");
  first.getState().startSearch();

  const raw = localStorage.getItem(
    reviewUiStateKey(TEST_REVIEW_CONFIG, "session", "find"),
  )!;

  expect(JSON.parse(raw).state).toEqual({
    text: "Alpha",
    matchCase: true,
    wholeWord: false,
    isRegex: false,
  });

  const restored = createReviewFindStore(TEST_REVIEW_CONFIG);
  expect(restored.getState().query).toEqual(first.getState().query);
  expect(restored.getState()).toMatchObject({
    open: false,
    searching: false,
    matches: [],
    activeIndex: -1,
  });
  expect(
    createReviewFindStore({ reviewId: "another-review" }).getState().query.text,
  ).toBe("");
});
