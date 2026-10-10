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
  /** What gets the ring, when not the target. */
  highlightSelector?: string;
}

export const TUTORIAL_CHAPTERS: readonly TutorialChapterDefinition[] = [
  { id: "welcome", title: "Welcome" },
  { id: "diffs", title: "Diffs and lenses" },
  { id: "diagrams", title: "Interactive diagrams" },
  { id: "finish", title: "Get help" },
];

export const TUTORIAL_STEPS: readonly TutorialStepDefinition[] = [
  {
    id: "chooseKeymap",
    chapter: "welcome",
    title: "Choose your keybindings",
    instruction:
      "Choose the editor keys you want to use while reading sessions.",
    completion: "external",
    targetSelector: ".tutorial-keymap-picker",
  },
  {
    id: "showHover",
    chapter: "welcome",
    title: "Inspect a symbol",
    instruction:
      "Hover a symbol in the live editor to see its type. Go to Definition works with your usual keys too.",
    completion: "inline-hover",
    targetSelector:
      '[data-review-section="Welcome"] [data-review-inline-editor]',
  },
  {
    id: "openDiff",
    chapter: "diffs",
    title: "Open the diff",
    instruction:
      "Open Diff to see the whole change, with unchanged structure folded away.",
    completion: "click",
    targetSelector:
      '.review-segment[aria-label="Diff"], .tutorial-view-button[data-tutorial-view="diff"]',
  },
  {
    id: "selectLens",
    chapter: "diffs",
    title: "Filter with a lens",
    instruction: "Select a lens to filter the diff to just that part.",
    completion: "click",
    targetSelector:
      ".diff-sidebar-lenses [data-lens-id] button[aria-pressed]:not(:disabled)",
    highlightSelector:
      ".diff-sidebar-lenses [data-lens-id]:first-of-type button[aria-pressed]",
  },
  {
    id: "expandFold",
    chapter: "diffs",
    title: "Expand a fold",
    instruction: "Select a folded region to reveal the code diffr hid.",
    completion: "click",
    targetSelector: ".review-fold-pill, .diff-fold-reveal",
  },
  {
    id: "backToWhiteboard",
    chapter: "diffs",
    title: "Back to the whiteboard",
    instruction: "Select Whiteboard to return to the document.",
    completion: "click",
    targetSelector: '.review-segment[aria-label="Whiteboard"]',
  },
  {
    id: "openSequence",
    chapter: "diagrams",
    title: "Walk the sequence",
    instruction:
      "Open the sequence Tour, then step to the next message to follow its code.",
    completion: "tour-advance",
    tour: "sequence",
    targetSelector:
      '[data-review-section="Interactive diagrams"] .sequence-diagram .diagram-tour-button, .diagram-tour-overlay .tour-pager-next',
  },
  {
    id: "closeSequence",
    chapter: "diagrams",
    title: "Close the tour",
    instruction: "Close the tour to return to the document.",
    completion: "tour-close",
    tour: "sequence",
    targetSelector:
      '.diagram-tour-overlay button[aria-label="Close guided tour"]',
  },
  {
    id: "openDatabase",
    chapter: "diagrams",
    title: "Inspect the database flow",
    instruction:
      "Open the database Tour to follow the order write from the service into storage.",
    completion: "tour-open",
    tour: "database",
    targetSelector:
      '[data-review-section="Interactive diagrams"] .database-lens .diagram-tour-button',
  },
  {
    id: "getHelp",
    chapter: "finish",
    title: "Know where to get help",
    instruction:
      "Use Settings to connect your agents, or Getting Started to revisit setup and this tour.",
    completion: "finish",
    targetSelector: '[data-review-section="Get help"] .review-section-body',
  },
];

export function tutorialChapter(
  id: TutorialChapterId,
): TutorialChapterDefinition {
  return TUTORIAL_CHAPTERS.find((chapter) => chapter.id === id)!;
}
