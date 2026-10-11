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
import { INLINE_HOVER_EVENT } from "./inline-hover-event";
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
  TUTORIAL_TARGETS,
  type TutorialChapterId,
  type TutorialStepDefinition,
  TUTORIAL_STEPS as steps,
  tutorialChapter,
} from "./tutorial-plan";
import {
  type TutorialChapterState,
  TutorialSectionProvider,
} from "./tutorial-section-context";

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
  // The shell ref belongs to an ancestor, so it attaches after this
  // provider's layout effects. Read it once mounted and key effects on it.
  const [shell, setShell] = useState<HTMLElement | null>(null);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setShell(shellRef.current);
    setRegion(scrollRegionRef?.current ?? null);
  }, [scrollRegionRef, shellRef]);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  const overlayTour = useOptionalReviewPanel((state) => state.overlayTour);

  const closeOverlayTour = useOptionalReviewPanel(
    (state) => state.closeOverlayTour,
  );

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

  // Finishing hides the guide at once; closing the review is not instant.
  const [finished, setFinished] = useState(false);
  const hidden = !tutorial || dismissed || finished;
  const aboveTour = tourKind !== null;

  const completeStep = useCallback(
    (step: TutorialStepDefinition) => {
      if (!tutorial || checked.has(step.id)) return;
      tutorial.setStep(step.id, true);
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
      if (activeStep.completion !== "click") return;
      const clicked = event.target;

      if (!(clicked instanceof Element)) return;

      if (clicked.closest(activeStep.targetSelector)) completeStep(activeStep);
    };

    const onInlineHover = () => {
      if (activeStep.completion === "inline-hover") completeStep(activeStep);
    };

    // Monaco acts on pointer down.
    root.addEventListener("pointerdown", onClick, true);
    root.addEventListener("click", onClick, true);
    root.addEventListener(INLINE_HOVER_EVENT, onInlineHover);

    return () => {
      root.removeEventListener("pointerdown", onClick, true);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener(INLINE_HOVER_EVENT, onInlineHover);
    };
  }, [activeStep, completeStep, dismissed, root]);

  // Ring the topmost visible match, re-queried at most once per frame.
  useLayoutEffect(() => {
    if (!root || hidden || !activeStep) {
      setTarget(null);

      return;
    }

    let marked: HTMLElement | null = null;
    let revealed = false;
    let scheduledFrame: number | null = null;

    const apply = () => {
      let next: HTMLElement | null = null;
      let nextBox: DOMRect | null = null;

      for (const candidate of root.querySelectorAll<HTMLElement>(
        activeStep.highlightSelector ?? activeStep.targetSelector,
      )) {
        // Over a fullscreen tour, only its own targets show.
        if (
          !candidate.checkVisibility({
            visibilityProperty: true,
            opacityProperty: true,
          }) ||
          (aboveTour &&
            candidate.closest(TUTORIAL_TARGETS.tourOverlay) === null)
        )
          continue;

        const box = candidate.getBoundingClientRect();

        if (box.width === 0) continue;

        if (
          !nextBox ||
          box.top < nextBox.top ||
          (box.top === nextBox.top && box.left < nextBox.left)
        ) {
          next = candidate;
          nextBox = box;
        }
      }

      if (marked && marked !== next) delete marked.dataset.tutorialTarget;

      if (next) next.dataset.tutorialTarget = activeStep.id;
      marked = next;
      setTarget(next);

      // Bring an off-screen target into view once per step.
      if (!next || revealed) return;
      revealed = true;

      const view = (
        root.querySelector(TUTORIAL_TARGETS.viewRegion) ?? root
      ).getBoundingClientRect();

      const rect = next.getBoundingClientRect();

      if (rect.bottom > view.bottom || rect.top < view.top) {
        next.scrollIntoView({ block: "center", behavior: "smooth" });
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
      attributeFilter: ["hidden", "aria-hidden"],
      childList: true,
      subtree: true,
    });
    apply();

    return () => {
      observer.disconnect();

      if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);

      if (marked) delete marked.dataset.tutorialTarget;
    };
  }, [aboveTour, activeStep, hidden, root]);

  const ring = useTargetRing(target, layer, region);

  // Back reopens the previous step only, so crossing a chapter boundary
  // lands on that chapter's last step rather than its first.
  const goBack = useCallback(() => {
    if (!tutorial || activeIndex <= 0) return;
    tutorial.setStep(steps[activeIndex - 1]!.id, false);
  }, [activeIndex, tutorial]);

  const goNext = useCallback(() => {
    if (!tutorial || !activeStep || activeStep.completion === "finish") return;

    // Closing the tour completes the step, as the close button would.
    if (activeStep.completion === "tour-close" && tourKind === activeStep.tour)
      closeOverlayTour?.();
    else tutorial.setStep(activeStep.id, true);
  }, [activeStep, closeOverlayTour, tourKind, tutorial]);

  const finishTour = useCallback(() => {
    if (!tutorial || activeStep?.completion !== "finish") return;
    setFinished(true);
    completeStep(activeStep);
    tutorial.close();
  }, [activeStep, completeStep, tutorial]);

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
  const guideLayer =
    tutorial && !finished ? (
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
          <TutorialGuide
            activeStep={activeStep}
            activeIndex={activeIndex}
            aboveTour={aboveTour}
            onBack={goBack}
            onNext={goNext}
            onDismiss={tutorial.dismiss}
            onFinish={finishTour}
            onClose={tutorial.close}
          />
        )}
        {ring?.host === "layer" ? <TutorialTargetRing ring={ring} /> : null}
      </div>
    ) : null;

  return (
    <TutorialSectionProvider value={sectionValue}>
      {children}
      {region && ring?.host === "region"
        ? createPortal(
            <div {...stylex.props(styles.targetLayer)} aria-hidden="true">
              <TutorialTargetRing ring={ring} />
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
  activeStep,
  activeIndex,
  aboveTour,
  onBack,
  onNext,
  onDismiss,
  onFinish,
  onClose,
}: {
  activeStep: TutorialStepDefinition | null;
  activeIndex: number;
  aboveTour: boolean;
  onBack(): void;
  onNext(): void;
  onDismiss(): void;
  onFinish(): void;
  onClose(): void;
}): ReactElement {
  const chapter = tutorialChapter(activeStep?.chapter ?? "finish");

  const chapterIndex = TUTORIAL_CHAPTERS.findIndex(
    (candidate) => candidate.id === chapter.id,
  );

  // "3.2" reads as chapter 3, step 2 within that chapter.
  const stepInChapter = activeStep
    ? steps
        .filter((step) => step.chapter === activeStep.chapter)
        .findIndex((step) => step.id === activeStep.id) + 1
    : 0;

  const chapterLabel = stepInChapter
    ? `${chapterIndex + 1}.${stepInChapter}`
    : `${chapterIndex + 1}`;

  return (
    <aside
      {...stylex.props(styles.guide, aboveTour && styles.guideAboveTour)}
      aria-label="Tutorial guide"
      data-tutorial-step={activeStep?.id ?? "complete"}
    >
      <header {...stylex.props(styles.guideHeader)}>
        <span {...stylex.props(styles.guideChapter)}>
          Chapter {chapterLabel} of {TUTORIAL_CHAPTERS.length}
        </span>
        <IconButton
          xstyle={styles.guideClose}
          onClick={onDismiss}
          aria-label="Hide tutorial"
        >
          ×
        </IconButton>
      </header>
      <div {...stylex.props(styles.progress)} aria-hidden="true">
        <span
          {...stylex.props(styles.progressBar)}
          style={{
            width: `${Math.round((activeIndex / steps.length) * 100)}%`,
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
      </div>
      <footer {...stylex.props(styles.guideFooter)}>
        <Button variant="ghost" onClick={onBack} disabled={activeIndex <= 0}>
          Back
        </Button>
        {activeStep?.completion === "finish" ? (
          <Button variant="ghost" onClick={onFinish}>
            Finish tour
          </Button>
        ) : activeStep ? (
          <Button variant="ghost" onClick={onNext}>
            Next
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close tutorial
          </Button>
        )}
      </footer>
    </aside>
  );
}

interface TutorialRing {
  /** Where the ring is drawn: inside the scroll region (moves with the
      content) or in the guide's layer (toolbar, Diff and tour targets). */
  host: "region" | "layer";
  radius: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

const RING_GAP = 4;

/** Measures the target's ring. Inside the scroll region, the ring uses the
    region's coordinates so it scrolls with the content. */
function useTargetRing(
  target: HTMLElement | null,
  layer: HTMLElement | null,
  region: HTMLElement | null,
): TutorialRing | null {
  const [ring, setRing] = useState<TutorialRing | null>(null);
  useLayoutEffect(() => {
    if (!layer || !target) {
      setRing(null);

      return;
    }

    const inRegion = region !== null && region.contains(target);
    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        const radius = parseFloat(getComputedStyle(target).borderRadius);

        const base = {
          radius: (Number.isFinite(radius) ? radius : 4) + RING_GAP,
          width: rect.width,
          height: rect.height,
        };

        if (inRegion) {
          const regionRect = region.getBoundingClientRect();

          setRing({
            ...base,
            host: "region",
            left: rect.left - regionRect.left + region.scrollLeft,
            top: rect.top - regionRect.top + region.scrollTop,
          });

          return;
        }

        // Keep an edge target's ring inside the layer, centered.
        const layerRect = layer.getBoundingClientRect();
        const left = rect.left - layerRect.left;
        const top = rect.top - layerRect.top;
        const inset = RING_GAP + 2;

        const dx = Math.max(
          0,
          inset - left,
          left + rect.width - (layerRect.width - inset),
        );

        const dy = Math.max(
          0,
          inset - top,
          top + rect.height - (layerRect.height - inset),
        );

        setRing({
          ...base,
          host: "layer",
          left: left + dx,
          top: top + dy,
          width: Math.max(0, rect.width - dx * 2),
          height: Math.max(0, rect.height - dy * 2),
        });
      });
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);

    resizeObserver?.observe(target);

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
    const tracksScroll =
      !inRegion || target.closest(".monaco-scrollable-element") !== null;

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
  }, [layer, region, target]);

  return ring;
}

function TutorialTargetRing({ ring }: { ring: TutorialRing }): ReactElement {
  return (
    <div
      data-tutorial-ring=""
      {...stylex.props(styles.ring)}
      style={{
        left: ring.left - RING_GAP,
        top: ring.top - RING_GAP,
        width: ring.width + RING_GAP * 2,
        height: ring.height + RING_GAP * 2,
        borderRadius: ring.radius,
      }}
    />
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

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  // The tutorial lives in the bottom right corner of the shell, one layer
  // above the sticky toolbar, in every view.
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
  // The ring is drawn in a layer nothing clips: the scroll region for
  // document content, the shell overlay otherwise.
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
