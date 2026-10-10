import { documentType } from "@canvas/document-type.stylex";
import { Button, IconButton } from "@canvas/ui/button";
import type { TutorialStepId } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useReviewDebugSettings } from "./debug-settings";
import { TutorialIcon } from "./icons";
import {
  REVIEW_INTERACTION_EVENT,
  reviewInteractionDetail,
} from "./review-interaction-event";
import { useOptionalReviewPanel } from "./review-panel";
import type { OverlayTourKind } from "./review-panel-store";
import { useReviewContainer } from "./review-root-context";
import {
  elevation,
  fontSize,
  fontWeight,
  motion,
  radius,
  tracking,
} from "./scale.stylex";
import { withClass } from "./stylex-props";
import { themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";
import { useTutorial } from "./tutorial-context";
import {
  TUTORIAL_CHAPTERS,
  type TutorialChapterId,
  type TutorialStepDefinition,
  TUTORIAL_STEPS as steps,
  tutorialChapter,
} from "./tutorial-plan";
import {
  type TutorialChapterState,
  TutorialSectionProvider,
} from "./tutorial-section-context";

interface TutorialExperienceState {
  activeStep: TutorialStepDefinition | null;
  activeIndex: number;
  steps: readonly TutorialStepDefinition[];
  totalSteps: number;
  hidden: boolean;
  aboveTour: boolean;
  awaitingNext: boolean;
  onBack(): void;
  onNext(): void;
  onDismiss(): void;
  onFinish(): void;
  onClose(): void;
}

/**
 * Drives the tutorial for the document shell it wraps. The guide card sits in
 * the bottom right corner of the shell in every view, bottom left over a
 * fullscreen diagram tour; hidden, it shrinks to a small floating button. The
 * step's target carries `data-tutorial-target` for its highlight.
 */
export function TutorialExperienceProvider({
  shellRef,
  scrollRegionRef,
  children,
}: {
  shellRef: RefObject<HTMLElement | null>;
  /** The scrolling view region; target rings for its content live inside
      it so they scroll with the content. */
  scrollRegionRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}): ReactElement {
  const tutorial = useTutorial();
  const container = useReviewContainer();
  const { theme } = useReviewDebugSettings();
  const revealedChapterRef = useRef<TutorialChapterId | null>(null);
  // The shell ref belongs to an ancestor, so it attaches after this
  // provider's layout effects. Read it once mounted and key effects on it.
  const [shell, setShell] = useState<HTMLElement | null>(null);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setShell(shellRef.current);
    setRegion(scrollRegionRef?.current ?? null);
  }, [scrollRegionRef, shellRef]);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [targets, setTargets] = useState<readonly HTMLElement[]>([]);

  const overlayTour = useOptionalReviewPanel((state) => state.overlayTour);
  const tourKind = overlayTour?.kind ?? null;
  const tourAnchor = overlayTour?.anchor ?? null;
  // Fullscreen tours portal outside the shell.
  const root = container ?? shell;

  const checkedKey = tutorial?.content.progress.checked.join("\u0000") ?? "";

  const checked = useMemo(
    () => new Set(tutorial?.content.progress.checked ?? []),
    [checkedKey],
  );

  const activeStep = steps.find((step) => !checked.has(step.id)) ?? null;
  const activeChapterId: TutorialChapterId = activeStep?.chapter ?? "finish";
  const dismissed = tutorial?.content.progress.dismissed ?? true;
  const completed = activeStep === null;

  const activeIndex = activeStep
    ? steps.findIndex((step) => step.id === activeStep.id)
    : steps.length;

  const hidden = !tutorial || dismissed;
  const aboveTour = tourKind !== null;

  // A confirm step, once done, waits for Next.
  const [doneStep, setDoneStep] = useState<TutorialStepId | null>(null);
  const awaitingNext = activeStep !== null && doneStep === activeStep.id;

  const completeStep = useCallback(
    (step: TutorialStepDefinition) => {
      if (!tutorial || checked.has(step.id)) return;

      if (step.confirm) setDoneStep(step.id);
      else tutorial.setStep(step.id, true);
    },
    [checked, tutorial],
  );

  // The anchor a watched tour opened on; moving off it advances the tour.
  const openedAnchorRef = useRef<string | null>(null);
  const lastTourRef = useRef<OverlayTourKind | null>(null);

  useEffect(() => {
    const closedTour = tourKind ? null : lastTourRef.current;
    lastTourRef.current = tourKind;

    if (tourKind) openedAnchorRef.current ??= tourAnchor;
    else openedAnchorRef.current = null;

    if (dismissed || !activeStep?.tour) return;

    const done =
      activeStep.completion === "tour-close"
        ? closedTour === activeStep.tour
        : activeStep.tour === tourKind &&
          (activeStep.completion === "tour-open" ||
            (activeStep.completion === "tour-advance" &&
              tourAnchor !== openedAnchorRef.current));

    if (done) completeStep(activeStep);
  }, [activeStep, completeStep, dismissed, tourAnchor, tourKind]);

  useEffect(() => {
    if (!root || dismissed || !activeStep) return;

    const onClick = (event: Event) => {
      if (awaitingNext || activeStep.completion !== "click") return;
      const clicked = event.target;

      if (!(clicked instanceof Element)) return;

      if (clicked.closest(activeStep.targetSelector)) completeStep(activeStep);
    };

    const onReviewInteraction = (event: Event) => {
      if (
        activeStep.completion === "inline-hover" &&
        reviewInteractionDetail(event)
      )
        completeStep(activeStep);
    };

    // Monaco acts on pointer down.
    root.addEventListener("pointerdown", onClick, true);
    root.addEventListener("click", onClick, true);
    root.addEventListener(REVIEW_INTERACTION_EVENT, onReviewInteraction);

    return () => {
      root.removeEventListener("pointerdown", onClick, true);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener(REVIEW_INTERACTION_EVENT, onReviewInteraction);
    };
  }, [activeStep, awaitingNext, completeStep, dismissed, root]);

  // Bring a newly active chapter into view once. The section itself expands
  // through the section context; nothing collapses the other chapters.
  useLayoutEffect(() => {
    const root = shell;

    if (!root || hidden) {
      revealedChapterRef.current = null;

      return;
    }

    if (revealedChapterRef.current === activeChapterId) return;
    revealedChapterRef.current = activeChapterId;
    const activeTitle = tutorialChapter(activeChapterId).title;
    [...root.querySelectorAll<HTMLElement>("[data-review-section]")]
      .find((section) => section.dataset.reviewSection === activeTitle)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [activeChapterId, hidden, shell]);

  // Mark the active step's target. DOM changes coalesce into one query per
  // frame; no geometry is measured and state changes only when the answer does.
  useLayoutEffect(() => {
    if (!root || hidden || !activeStep) {
      setTargets([]);

      return;
    }

    // A step can name several targets (a toolbar tab and a prose button that
    // open the same view); every match is marked.
    let targets: HTMLElement[] = [];
    let revealed = false;
    let scheduledFrame: number | null = null;

    const apply = () => {
      const next = [
        ...root.querySelectorAll<HTMLElement>(
          awaitingNext
            ? "[data-tutorial-next]"
            : (activeStep.highlightSelector ?? activeStep.targetSelector),
        ),
      ];

      for (const target of targets) {
        if (!next.includes(target)) delete target.dataset.tutorialTarget;
      }

      for (const target of next) target.dataset.tutorialTarget = activeStep.id;
      targets = next;

      // Over a fullscreen tour, only its own targets show.
      let visible = targets.filter(
        (target) =>
          target.closest("[hidden]") === null &&
          (!aboveTour || target.closest(".diagram-tour-overlay") !== null),
      );

      if (activeStep.ringFirst && !awaitingNext)
        visible = visible
          .map((target) => ({ target, box: target.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0)
          .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
          .slice(0, 1)
          .map(({ target }) => target);

      setTargets((current) =>
        current.length === visible.length &&
        current.every((target, index) => target === visible[index])
          ? current
          : visible,
      );

      // Bring an off-screen target into view once per step. This is the only
      // measurement the tutorial makes, and it happens on a step change, not
      // on scroll.
      const first = visible[0];

      if (first && !revealed) {
        revealed = true;

        const view = (
          root.querySelector(".review-view-region") ?? root
        ).getBoundingClientRect();

        const rect = first.getBoundingClientRect();

        if (rect.bottom > view.bottom || rect.top < view.top) {
          first.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      }
    };

    const scheduleApply = () => {
      if (scheduledFrame !== null) return;
      scheduledFrame = requestAnimationFrame(() => {
        scheduledFrame = null;
        apply();
      });
    };

    const observer = new MutationObserver(scheduleApply);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["hidden"],
      childList: true,
      subtree: true,
    });
    apply();

    return () => {
      observer.disconnect();

      if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);

      for (const target of targets) delete target.dataset.tutorialTarget;
    };
  }, [aboveTour, activeStep, awaitingNext, hidden, root]);

  const rings = useTargetRings(targets, layer, region);

  // Back reopens the previous step only, so crossing a chapter boundary
  // lands on that chapter's last step rather than its first.
  const goBack = useCallback(() => {
    if (!tutorial || activeIndex <= 0) return;
    setDoneStep(null);
    tutorial.setStep(steps[activeIndex - 1]!.id, false);
  }, [activeIndex, tutorial]);

  const goNext = useCallback(() => {
    if (!tutorial || !activeStep || activeStep.completion === "finish") return;
    tutorial.setStep(activeStep.id, true);
  }, [activeStep, tutorial]);

  const finishTour = useCallback(() => {
    if (!tutorial || activeStep?.completion !== "finish") return;
    completeStep(activeStep);
    tutorial.close();
  }, [activeStep, completeStep, tutorial]);

  const experience: TutorialExperienceState | null = tutorial
    ? {
        activeStep,
        activeIndex,
        steps,
        totalSteps: steps.length,
        hidden,
        aboveTour,
        awaitingNext,
        onBack: goBack,
        onNext: goNext,
        onDismiss: tutorial.dismiss,
        onFinish: finishTour,
        onClose: tutorial.close,
      }
    : null;

  const sectionValue = useMemo(() => {
    const chapterStates = new Map<string, TutorialChapterState>();

    if (!tutorial || dismissed) return { chapterStates };

    for (const chapter of TUTORIAL_CHAPTERS) {
      const chapterSteps = steps.filter((step) => step.chapter === chapter.id);

      const chapterComplete =
        chapter.id === "finish"
          ? completed
          : chapterSteps.every((step) => checked.has(step.id));

      chapterStates.set(
        chapter.title,
        chapter.id === activeChapterId
          ? "active"
          : chapterComplete
            ? "complete"
            : "upcoming",
      );
    }

    return { chapterStates };
  }, [activeChapterId, checked, completed, dismissed, tutorial]);

  // Over a fullscreen tour the layer portals beside it, so it carries the theme.
  const guideLayer = tutorial ? (
    <div
      ref={setLayer}
      {...withClass(
        aboveTour ? `review-app--theme-${theme}` : undefined,
        aboveTour && themeStyles.vars,
        aboveTour && theme === "light" && themeStyles.light,
        styles.overlay,
        aboveTour && styles.overlayAboveTour,
      )}
    >
      {dismissed ? (
        <button
          type="button"
          {...stylex.props(styles.pill, aboveTour && styles.pillAboveTour)}
          aria-label="Show tutorial"
          title="Show tutorial"
          onClick={tutorial.reopen}
        >
          <TutorialIcon xstyle={styles.pillIcon} />
        </button>
      ) : (
        <TutorialGuide experience={experience} />
      )}
      {rings
        .filter((ring) => ring.host === "layer")
        .map((ring) => (
          <TutorialTargetRing key={ring.key} ring={ring} />
        ))}
    </div>
  ) : null;

  return (
    <TutorialSectionProvider value={sectionValue}>
      {children}
      {region && rings.some((ring) => ring.host === "region")
        ? createPortal(
            <div {...stylex.props(styles.targetLayer)} aria-hidden="true">
              {rings
                .filter((ring) => ring.host === "region")
                .map((ring) => (
                  <TutorialTargetRing key={ring.key} ring={ring} />
                ))}
            </div>,
            region,
          )
        : null}
      {guideLayer && aboveTour && container
        ? createPortal(guideLayer, container)
        : guideLayer}
    </TutorialSectionProvider>
  );
}

/** The guide card: chapter, step, instruction, and tour controls. */
function TutorialGuide({
  experience,
}: {
  experience: TutorialExperienceState | null;
}): ReactElement | null {
  if (!experience || experience.hidden) return null;
  const { activeStep, activeIndex, totalSteps } = experience;
  const chapter = tutorialChapter(activeStep?.chapter ?? "finish");

  const chapterIndex = TUTORIAL_CHAPTERS.findIndex(
    (candidate) => candidate.id === chapter.id,
  );

  // "3.2" reads as chapter 3, step 2 within that chapter.
  const stepInChapter = activeStep
    ? experience.steps
        .filter((step) => step.chapter === activeStep.chapter)
        .findIndex((step) => step.id === activeStep.id) + 1
    : 0;

  const chapterLabel = stepInChapter
    ? `${chapterIndex + 1}.${stepInChapter}`
    : `${chapterIndex + 1}`;

  return (
    <aside
      {...stylex.props(
        styles.guide,
        experience.aboveTour && styles.guideAboveTour,
      )}
      aria-label="Tutorial guide"
      data-tutorial-step={activeStep?.id ?? "complete"}
    >
      <header {...stylex.props(styles.guideHeader)}>
        <span {...stylex.props(styles.guideChapter)}>
          Chapter {chapterLabel} of {TUTORIAL_CHAPTERS.length}
        </span>
        <IconButton
          xstyle={styles.guideClose}
          onClick={experience.onDismiss}
          aria-label="Hide tutorial"
        >
          ×
        </IconButton>
      </header>
      <div {...stylex.props(styles.progress)} aria-hidden="true">
        <span
          {...stylex.props(styles.progressBar)}
          style={{
            width: `${Math.round((activeIndex / Math.max(1, totalSteps)) * 100)}%`,
          }}
        />
      </div>
      <div {...stylex.props(styles.copy)}>
        <p {...stylex.props(styles.chapter)}>{chapter.title}</p>
        <h2 {...stylex.props(styles.step)}>
          {activeStep?.title ?? "Tour complete"}
        </h2>
        <p {...stylex.props(styles.instruction)}>
          {activeStep?.instruction ??
            "You have walked through the core Whiteboard experience."}
        </p>
        {experience.awaitingNext ? (
          <p {...stylex.props(styles.chapter)}>Done. Select Next to go on.</p>
        ) : null}
      </div>
      <footer {...stylex.props(styles.guideFooter)}>
        <Button
          variant="ghost"
          onClick={experience.onBack}
          disabled={activeIndex <= 0}
        >
          Back
        </Button>
        {activeStep?.completion === "finish" ? (
          <Button variant="ghost" onClick={experience.onFinish}>
            Finish tour
          </Button>
        ) : activeStep ? (
          <Button
            variant="ghost"
            onClick={experience.onNext}
            data-tutorial-next=""
          >
            Next
          </Button>
        ) : (
          <Button variant="ghost" onClick={experience.onClose}>
            Close tutorial
          </Button>
        )}
      </footer>
    </aside>
  );
}

interface TutorialRingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TutorialRing {
  key: string;
  /** Where the ring is drawn: inside the scroll region (moves with the
      content) or in the guide's layer (toolbar, Diff and tour targets). */
  host: "region" | "layer";
  /** Inline targets (links) get one wash box per line, no outline. */
  inline: boolean;
  radius: number;
  boxes: TutorialRingBox[];
}

const RING_GAP = 4;

/**
 * Measures the marked targets and describes a ring for each. Measurement
 * happens on a target change, on a target or content resize, on a window
 * resize, and when a nested scroller moves. Rings for content inside the
 * scroll region are placed in the region's own coordinate space, so they
 * travel with the content and never lag.
 */
function useTargetRings(
  targets: readonly HTMLElement[],
  layer: HTMLElement | null,
  region: HTMLElement | null,
): TutorialRing[] {
  const [rings, setRings] = useState<TutorialRing[]>([]);
  useLayoutEffect(() => {
    if (!layer || targets.length === 0) {
      setRings([]);

      return;
    }

    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const layerRect = layer.getBoundingClientRect();
        const regionRect = region?.getBoundingClientRect();
        setRings(
          targets.map((target, index) => {
            const inRegion = region !== null && region.contains(target);

            const originLeft =
              inRegion && regionRect
                ? regionRect.left - region.scrollLeft
                : layerRect.left;

            const originTop =
              inRegion && regionRect
                ? regionRect.top - region.scrollTop
                : layerRect.top;

            const inline = target instanceof HTMLAnchorElement;

            const rects = inline
              ? [...target.getClientRects()]
              : [target.getBoundingClientRect()];

            const radius = parseFloat(getComputedStyle(target).borderRadius);

            return {
              key: `${index}:${target.dataset.tutorialTarget ?? ""}`,
              host: inRegion ? "region" : "layer",
              inline,
              radius: (Number.isFinite(radius) ? radius : 4) + RING_GAP,
              boxes: (rects.length ? rects : [target.getBoundingClientRect()])
                // A wrapped link reports an empty rect at the break.
                .filter((rect, _, all) => all.length === 1 || rect.width > 0)
                .map((rect) => {
                  const box = {
                    left: rect.left - originLeft,
                    top: rect.top - originTop,
                    width: rect.width,
                    height: rect.height,
                  };

                  if (inRegion) return box;

                  // Keep an edge-to-edge target's ring inside the layer.
                  const inset = RING_GAP + 2;
                  const left = Math.max(box.left, inset);
                  const top = Math.max(box.top, inset);

                  const right = Math.min(
                    box.left + box.width,
                    layerRect.width - inset,
                  );

                  const bottom = Math.min(
                    box.top + box.height,
                    layerRect.height - inset,
                  );

                  return {
                    left,
                    top,
                    width: Math.max(0, right - left),
                    height: Math.max(0, bottom - top),
                  };
                }),
            };
          }),
        );
      });
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);

    for (const target of targets) resizeObserver?.observe(target);

    // Content above a target can grow (an editor mounts)
    // without the target itself resizing, so watch the region's content too.
    if (region) {
      for (const child of region.querySelectorAll(
        ":scope > *, :scope > .review-document-view > *",
      )) {
        resizeObserver?.observe(child);
      }
    }

    // Monaco scrolls without scroll events, so wheels re-measure too.
    const tracksScroll = targets.some(
      (target) =>
        !region?.contains(target) ||
        target.closest(".monaco-scrollable-element") !== null,
    );

    let settle = 0;

    const onScroll = (event: Event) => {
      if (event.target === region) return;
      measure();
      window.clearTimeout(settle);
      settle = window.setTimeout(measure, 160);
    };

    window.addEventListener("resize", measure);
    // Rows that animate in settle without resizing.
    document.addEventListener("animationend", measure, true);
    document.addEventListener("transitionend", measure, true);

    if (tracksScroll) {
      document.addEventListener("scroll", onScroll, true);
      document.addEventListener("wheel", onScroll, {
        capture: true,
        passive: true,
      });
    }

    measure();

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("animationend", measure, true);
      document.removeEventListener("transitionend", measure, true);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("wheel", onScroll, true);
    };
  }, [layer, region, targets]);

  return rings;
}

function TutorialTargetRing({ ring }: { ring: TutorialRing }): ReactElement {
  return (
    <>
      {ring.boxes.map((box, index) => (
        <div
          key={index}
          data-tutorial-ring=""
          {...stylex.props(styles.ring, ring.inline && styles.ringInline)}
          style={
            ring.inline
              ? {
                  left: box.left - 4,
                  top: box.top - 1,
                  width: box.width + 8,
                  height: box.height + 2,
                }
              : {
                  left: box.left - RING_GAP,
                  top: box.top - RING_GAP,
                  width: box.width + RING_GAP * 2,
                  height: box.height + RING_GAP * 2,
                  borderRadius: ring.radius,
                }
          }
        />
      ))}
    </>
  );
}

// Target rings breathe a little.
const targetPulse = stylex.keyframes({
  "0%, 100%": {
    boxShadow: `0 0 0 4px ${tokens.tutorialRingGlow}`,
  },
  "50%": {
    boxShadow: `0 0 0 8px color-mix(in srgb, ${tokens.tutorialRingGlow} 45%, transparent)`,
  },
});

const linkPulse = stylex.keyframes({
  "0%, 100%": {
    backgroundColor: tokens.tutorialRingGlow,
  },
  "50%": {
    backgroundColor: `color-mix(in srgb, ${tokens.tutorialRing} 22%, transparent)`,
  },
});

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  // The tutorial lives in the bottom right corner of the shell, one layer
  // above the sticky toolbar, in every view. It never measures its target:
  // the target carries data-tutorial-target and draws its own outline.
  overlay: {
    position: "absolute",
    zIndex: `calc(${tokens.reviewDebugLayer} + 1)`,
    inset: 0,
    pointerEvents: "none",
  },
  // One layer above the tour overlay, which uses the same fallback.
  overlayAboveTour: {
    position: "fixed",
    zIndex: "calc(var(--review-debug-layer, 2147483000) + 1)",
  },
  // The workbench keeps a 10px strip under the canvas, so 8px here reads as
  // the same 18px gap from the window edge as the right side.
  guide: {
    position: "absolute",
    right: "18px",
    bottom: "8px",
    display: "flex",
    flexDirection: "column",
    width: "min(292px, calc(100% - 36px))",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.tutorialGuideBorder,
    borderRadius: radius.surface,
    backgroundColor: tokens.tutorialGuideBg,
    color: tokens.ink,
    boxShadow: elevation.popover,
    pointerEvents: "auto",
    backdropFilter: "blur(16px)",
  },
  // Clear of the tour pane on the right.
  guideAboveTour: {
    right: "auto",
    left: "18px",
    bottom: "18px",
  },
  guideHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px 8px",
  },
  guideChapter: {
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    letterSpacing: tracking.chrome,
    textTransform: "uppercase",
  },
  guideClose: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.medium,
  },
  progress: {
    height: "2px",
    marginInline: "12px",
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: tokens.ruleSoft,
  },
  progressBar: {
    display: "block",
    height: "100%",
    borderRadius: "inherit",
    backgroundColor: tokens.tutorialRing,
    transition: {
      default: `width ${motion.medium} ${motion.ease}`,
      [reducedMotion]: "none",
    },
  },
  copy: {
    display: "flex",
    flexDirection: "column",
    gap: "7px",
    padding: "13px 14px 15px",
  },
  chapter: {
    margin: 0,
    color: tokens.tutorialRing,
    font: `${fontSize.small}/16px ${tokens.fontMono}`,
    textAlign: "left",
  },
  step: {
    margin: 0,
    color: tokens.ink,
    font: `${fontWeight.medium} ${documentType.body}/22px ${tokens.fontSerif}`,
    textAlign: "left",
  },
  instruction: {
    margin: 0,
    color: tokens.inkMuted,
    font: `${fontSize.body}/18px ${tokens.fontMono}`,
    textAlign: "left",
  },
  guideFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "9px 12px 10px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.ruleSoft,
  },
  // The hidden tutorial: a small floating button in the same corner.
  pill: {
    position: "absolute",
    right: "28px",
    bottom: "18px",
    display: "grid",
    placeItems: "center",
    width: "44px",
    height: "44px",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.tutorialGuideBorder,
    borderRadius: radius.round,
    backgroundColor: tokens.tutorialGuideBg,
    color: { default: tokens.tutorialRing, ":hover": tokens.ink },
    boxShadow: elevation.popover,
    cursor: "pointer",
    pointerEvents: "auto",
    backdropFilter: "blur(16px)",
    outline: {
      default: null,
      ":focus-visible": `2px solid ${tokens.tutorialRing}`,
    },
    outlineOffset: { default: null, ":focus-visible": "2px" },
  },
  // Target rings are their own elements, drawn in a layer nothing clips:
  // inside the scroll region for document content (so they travel with it),
  // in the shell overlay for toolbar controls. Each ring follows its
  // target's corner radius.
  targetLayer: {
    position: "absolute",
    zIndex: `calc(${tokens.reviewDebugLayer} + 1)`,
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    overflow: "visible",
    pointerEvents: "none",
  },
  ring: {
    position: "absolute",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: tokens.tutorialRing,
    boxShadow: `0 0 0 4px ${tokens.tutorialRingGlow}`,
    pointerEvents: "none",
    animationName: { default: targetPulse, [reducedMotion]: "none" },
    animationDuration: {
      default: motion.pulse,
      [reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "ease-in-out",
      [reducedMotion]: "ease",
    },
    animationIterationCount: { default: "infinite", [reducedMotion]: 1 },
  },
  // An inline link reads as marked text: one wash box per line.
  ringInline: {
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: radius.small,
    backgroundColor: tokens.tutorialRingGlow,
    boxShadow: "none",
    animationName: { default: linkPulse, [reducedMotion]: "none" },
  },
  pillAboveTour: {
    right: "auto",
    left: "28px",
  },
  pillIcon: {
    width: "22px",
    height: "22px",
    pointerEvents: "none",
    strokeWidth: "1.6px",
  },
});
