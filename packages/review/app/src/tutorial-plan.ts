import type { TutorialStepId } from "@dev.fast/review-protocol";

import type { OverlayTourKind } from "./review-panel-store";

export type TutorialChapterId = "welcome" | "diffs" | "diagrams" | "finish";

export type TutorialStepCompletion =
  | "external"
  | "click"
  | "inline-hover"
  | "tour-open"
  | "tour-advance"
  | "tour-close"
  | "finish";

export interface TutorialChapterDefinition {
  id: TutorialChapterId;
  title: string;
}

export interface TutorialStepDefinition {
  id: TutorialStepId;
  chapter: TutorialChapterId;
  title: string;
  instruction: string;
  completion: TutorialStepCompletion;
  /** The fullscreen tour a tour step watches. */
  tour?: OverlayTourKind;
  targetSelector: string;
  /** What gets the ring, when not the target; the topmost visible match. */
  highlightSelector?: string;
}

const target = (name: string) => `[data-tour-target="${name}"]`;

/**
 * Everything the tour looks for. Targets carry a `data-tour-target` name set by
 * the component that renders them. Folds and the containers a step searches
 * within keep their own class names.
 */
export const TUTORIAL_TARGETS = {
  keymapPicker: target("keymap-picker"),
  welcomeEditor: `[data-review-section="Welcome"] ${target("code-editor")}`,
  diffTab: target("diff-tab"),
  /** The Whiteboard tab shows the "review" view. */
  whiteboardTab: target("review-tab"),
  diffButton: target("open-diff"),
  lens: `${target("lens")}:not(:disabled)`,
  lensChip: `${target("lens")}:not(:disabled) ${target("lens-chip")}`,
  /** Folded code in a diff. */
  fold: ".review-fold-pill, .diff-fold-reveal",
  modifiedFold:
    ".modified-in-monaco-diff-editor :is(.diff-fold-reveal, .review-fold-pill)",
  sequenceTour: `[data-review-section="Interactive diagrams"] .sequence-diagram ${target("diagram-tour")}`,
  databaseTour: `[data-review-section="Interactive diagrams"] .database-lens ${target("diagram-tour")}`,
  /** The fullscreen diagram tour. */
  tourOverlay: ".diagram-tour-overlay",
  tourNext: `.diagram-tour-overlay ${target("tour-next")}`,
  tourClose: `.diagram-tour-overlay ${target("tour-close")}`,
  finishSection: `[data-review-section="You're all done"] ${target("section-body")}`,
  /** The view's scrolling region. */
  viewRegion: ".review-view-region",
} as const;

const T = TUTORIAL_TARGETS;

export const TUTORIAL_CHAPTERS: readonly TutorialChapterDefinition[] = [
  { id: "welcome", title: "Welcome" },
  { id: "diffs", title: "Diffs and lenses" },
  { id: "diagrams", title: "Interactive diagrams" },
  { id: "finish", title: "You're all done" },
];

export const TUTORIAL_STEPS: readonly TutorialStepDefinition[] = [
  {
    id: "chooseKeymap",
    chapter: "welcome",
    title: "Choose your keybindings",
    instruction:
      "Choose the editor keys you want to use while reading sessions.",
    completion: "external",
    targetSelector: T.keymapPicker,
  },
  {
    id: "showHover",
    chapter: "welcome",
    title: "Inspect a symbol",
    instruction:
      "Hover a symbol in the live editor to see its type. Go to Definition works with your usual keys too.",
    completion: "inline-hover",
    targetSelector: T.welcomeEditor,
  },
  {
    id: "openDiff",
    chapter: "diffs",
    title: "Open the diff",
    instruction:
      "Open Diff to see the whole change, with unchanged structure folded away.",
    completion: "click",
    targetSelector: `${T.diffTab}, ${T.diffButton}`,
    highlightSelector: T.diffTab,
  },
  {
    id: "selectLens",
    chapter: "diffs",
    title: "Filter with a lens",
    instruction: "Select a lens to filter the diff to just that part.",
    completion: "click",
    targetSelector: T.lens,
    highlightSelector: T.lensChip,
  },
  {
    id: "expandFold",
    chapter: "diffs",
    title: "Expand a fold",
    instruction: "Select a folded region to reveal the code diffr hid.",
    completion: "click",
    targetSelector: T.fold,
    highlightSelector: T.modifiedFold,
  },
  {
    id: "backToWhiteboard",
    chapter: "diffs",
    title: "Go back to the whiteboard",
    instruction: "Select Whiteboard to return to the document.",
    completion: "click",
    targetSelector: T.whiteboardTab,
  },
  {
    id: "openSequence",
    chapter: "diagrams",
    title: "Walk the sequence",
    instruction:
      "Open the sequence Tour, then step to the next message to follow its code.",
    completion: "tour-advance",
    tour: "sequence",
    targetSelector: `${T.sequenceTour}, ${T.tourNext}`,
  },
  {
    id: "closeSequence",
    chapter: "diagrams",
    title: "Close the tour",
    instruction: "Close the tour to return to the document.",
    completion: "tour-close",
    tour: "sequence",
    targetSelector: T.tourClose,
  },
  {
    id: "openDatabase",
    chapter: "diagrams",
    title: "Inspect the database flow",
    instruction:
      "Open the database Tour to follow the order write from the service into storage.",
    completion: "tour-open",
    tour: "database",
    targetSelector: T.databaseTour,
  },
  {
    id: "getHelp",
    chapter: "finish",
    title: "Tour complete!",
    instruction:
      "We hope you enjoy Whiteboard :), let us know what you think on GH or Discord.",
    completion: "finish",
    targetSelector: T.finishSection,
  },
];

export function tutorialChapter(
  id: TutorialChapterId,
): TutorialChapterDefinition {
  return TUTORIAL_CHAPTERS.find((chapter) => chapter.id === id)!;
}
