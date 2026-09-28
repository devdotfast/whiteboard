import type { ReviewFindQuery } from "@dev.fast/review-protocol";
import { createStore } from "zustand/vanilla";

import type { ReviewInlineFindRegistration } from "./review-find";

/** A match holds live DOM and editor handles, so it never outlives the
 * search that produced it. */
export type ReviewFindMatch =
  | { kind: "mdx"; range: Range; node: Node }
  | {
      kind: "editor";
      registration: ReviewInlineFindRegistration;
      localIndex: number;
      node: Node;
    };

export type ReviewFindOption = "matchCase" | "wholeWord" | "isRegex";

export interface ReviewFindState {
  open: boolean;
  query: ReviewFindQuery;
  searching: boolean;
  error: string | null;
  matches: readonly ReviewFindMatch[];
  activeIndex: number;
  /** Bumped by every transition that supersedes an outstanding search. */
  generation: number;
}

export interface ReviewFindActions {
  show: (seed?: string) => void;
  setText: (text: string) => void;
  toggleOption: (option: ReviewFindOption) => void;
  /** Starts a search and returns the generation its results must match. */
  startSearch: () => number;
  /** Commits results only if no later transition superseded them. */
  completeSearch: (
    generation: number,
    matches: readonly ReviewFindMatch[],
  ) => boolean;
  clearResults: () => void;
  rejectQuery: (error: string) => void;
  setActiveIndex: (index: number) => void;
  forgetRegistration: (registration: ReviewInlineFindRegistration) => void;
  close: (options?: { clearQuery?: boolean }) => void;
}

export type ReviewFindStore = ReturnType<typeof createReviewFindStore>;

const emptyResults = {
  searching: false,
  error: null,
  matches: [],
  activeIndex: -1,
} satisfies Partial<ReviewFindState>;

export function createReviewFindStore() {
  return createStore<ReviewFindState & ReviewFindActions>()((set, get) => ({
    open: false,
    query: { text: "", matchCase: false, wholeWord: false, isRegex: false },
    ...emptyResults,
    generation: 0,
    show: (seed) =>
      set((state) =>
        state.open
          ? state
          : {
              open: true,
              query: seed ? { ...state.query, text: seed } : state.query,
            },
      ),
    setText: (text) =>
      set((state) =>
        text === state.query.text ? state : { query: { ...state.query, text } },
      ),
    toggleOption: (option) =>
      set((state) => ({
        query: { ...state.query, [option]: !state.query[option] },
      })),
    startSearch: () => {
      const generation = get().generation + 1;
      set({ ...emptyResults, searching: true, generation });

      return generation;
    },
    completeSearch: (generation, matches) => {
      if (generation !== get().generation) return false;
      set({ searching: false, matches });

      return true;
    },
    clearResults: () =>
      set((state) => ({ ...emptyResults, generation: state.generation + 1 })),
    // An invalid expression keeps the last valid results on screen.
    rejectQuery: (error) =>
      set((state) => ({
        searching: false,
        error,
        generation: state.generation + 1,
      })),
    setActiveIndex: (activeIndex) => set({ activeIndex }),
    forgetRegistration: (registration) =>
      set((state) => {
        const matches = state.matches.filter(
          (match) =>
            match.kind !== "editor" || match.registration !== registration,
        );

        return matches.length === state.matches.length
          ? state
          : {
              matches,
              activeIndex: Math.min(state.activeIndex, matches.length - 1),
            };
      }),
    close: ({ clearQuery = false } = {}) =>
      set((state) => ({
        ...emptyResults,
        open: false,
        query:
          clearQuery && state.query.text
            ? { ...state.query, text: "" }
            : state.query,
        generation: state.generation + 1,
      })),
  }));
}
