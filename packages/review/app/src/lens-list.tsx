import { drawMotion } from "@canvas/draw-motion.stylex";
import { fontSize, fontWeight, motion, radius } from "@canvas/scale.stylex";
import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { CloseIcon } from "@canvas/ui/icons";
import { pillStyles } from "@canvas/ui/pill";
import { Spinner } from "@canvas/ui/spinner";
import { useTooltip } from "@canvas/ui/tooltip";
import type {
  ReviewSidebarCoverage,
  ReviewSidebarLenses,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useState } from "react";

import { DiffCountHalves, diffCountStyles } from "./diff-count";
import { drawStyles } from "./draw-styles";
import { lensChipMarker } from "./markers.stylex";
import { tokens } from "./tokens.stylex";
import { ProgressRing } from "./ui/progress-ring";
import { ViewedButton } from "./viewed-button";

/**
 * The Diff view's lens list. The canvas's Diff sidebar and Desktop's sidebar
 * both render it from the same data, so it keeps no state.
 */

// An empty label shows no tooltip, so only a truncated name gets one.
function LensName({ title, phase }: { title: string; phase?: string }) {
  const [truncated, setTruncated] = useState(false);

  const tooltip = useTooltip<HTMLSpanElement>(truncated ? title : "", {
    instant: true,
  });

  const ref = useCallback(
    (name: HTMLSpanElement | null) => {
      if (!name || typeof ResizeObserver === "undefined") return tooltip(name);

      const observer = new ResizeObserver(() =>
          setTruncated(name.scrollWidth > name.clientWidth),
        ),
        disposeTooltip = tooltip(name);

      observer.observe(name);

      return () => {
        observer.disconnect();
        disposeTooltip?.();
      };
    },
    [tooltip],
  );

  return (
    <span
      ref={ref}
      {...stylex.props(styles.name, phase === "relabel" && styles.nameRelabel)}
    >
      {title}
    </span>
  );
}

export function DiffCounts({
  progress,
  xstyle,
}: {
  progress: ReviewSidebarCoverage;
  xstyle?: stylex.StyleXStyles;
}) {
  const { remaining, total, folded } = progress;

  const tooltip = useTooltip<HTMLSpanElement>(
    `+${remaining.additions} −${remaining.deletions} remaining`,
    {
      instant: true,
      detail: `of +${total.additions} −${total.deletions} total${folded.additions + folded.deletions ? ` · +${folded.additions} −${folded.deletions} folded` : ""}`,
    },
  );

  return (
    <span
      ref={tooltip}
      {...stylex.props(
        diffCountStyles.counts,
        (progress.state === "viewed" || progress.state === "folded") && [
          lensRowStyles.faded,
          diffCountStyles.words,
        ],
        xstyle,
      )}
    >
      {progress.state === "viewed" ? (
        "Viewed"
      ) : progress.state === "folded" ? (
        "Folded"
      ) : (
        <DiffCountHalves
          additions={remaining.additions}
          deletions={remaining.deletions}
        />
      )}
    </span>
  );
}

export function ViewedRing({
  percent,
  title,
  size = 18,
  xstyle,
}: {
  percent: number;
  title: string;
  /** The ring's size in pixels. */
  size?: number;
  xstyle?: stylex.StyleXStyles;
}) {
  return (
    <span
      {...stylex.props(styles.ring, xstyle)}
      role="progressbar"
      aria-label="Changed lines viewed"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      title={title}
    >
      <ProgressRing percent={percent} size={size} />
      {percent}%
    </span>
  );
}

/** Remaining over the whole diff, and the share viewed. */
export function LensProgress({
  lenses,
  inset = false,
}: {
  lenses: ReviewSidebarLenses;
  /** Inline in the header of Desktop's Changes pane. */
  inset?: boolean;
}) {
  return (
    <div {...stylex.props(styles.progress, inset && styles.progressInset)}>
      <span {...stylex.props(styles.progressLabel)}>
        {lenses.unavailable ? (
          "Counts unavailable"
        ) : (
          <>
            Remaining{" "}
            {lenses.remaining ? (
              <DiffCounts progress={lenses.remaining} />
            ) : (
              <Spinner label="Counting changes" />
            )}
          </>
        )}
      </span>
      {lenses.viewed && (
        <ViewedRing {...lenses.viewed} size={inset ? 14 : 18} />
      )}
    </div>
  );
}

export const LENS_HINT = "Click any lens to filter the diff";

export function LensRows({
  lenses,
  onSelect,
  onMark,
  inset = false,
}: {
  lenses: ReviewSidebarLenses;
  /** Indent to match Desktop's sidebar. */
  inset?: boolean;
  /** A lens to filter to, or null to clear the filter. */
  onSelect(lensId: string | null): void;
  onMark(lensId: string): void;
}) {
  return (
    <>
      <div {...stylex.props(styles.hint, inset && styles.insetStart)}>
        {LENS_HINT}
      </div>
      {lenses.rows.map((item) => {
        const selected = lenses.active === item.id,
          { progress, phase, empty } = item;

        return (
          <section
            key={item.id}
            {...stylex.props(
              styles.section,
              selected && styles.sectionExpanded,
              phase !== undefined && sectionMotionStyle(phase),
            )}
            data-lens-id={item.id}
            data-motion={phase}
          >
            <div
              {...stylex.props(
                styles.row,
                phase === "landing" && drawStyles.rowLanding,
                phase === "erasing" && drawStyles.rowErasing,
              )}
            >
              <button
                {...stylex.props(
                  focusStyles.ringInset,
                  buttonStyles.reset,
                  styles.toggle,
                  inset && styles.toggleInset,
                  empty && lensRowStyles.toggleEmpty,
                  selected && styles.toggleActive,
                  progress.state === "viewed" &&
                    !selected &&
                    lensRowStyles.faded,
                )}
                aria-pressed={selected}
                data-tour-target="lens"
                disabled={!!item.unavailable || (empty && !selected)}
                onClick={() => onSelect(selected ? null : item.id)}
              >
                {/* The title and hover wash sit on the chip, not the
                    toggle, so they never stack on the counts' tooltip. */}
                <span
                  {...stylex.props(
                    lensChipMarker,
                    pillStyles.pill,
                    styles.chip,
                    selected && [pillStyles.active, styles.chipActive],
                  )}
                  data-tour-target="lens-chip"
                  title={
                    item.unavailable ??
                    (selected ? "Clear lens filter" : undefined)
                  }
                >
                  <LensName title={item.title} phase={phase} />
                  {selected && (
                    <span {...stylex.props(styles.clear)} aria-hidden="true">
                      <CloseIcon xstyle={styles.clearMark} />
                    </span>
                  )}
                </span>
                {item.pending ? (
                  <span
                    {...stylex.props(
                      diffCountStyles.counts,
                      styles.toggleCounts,
                    )}
                  >
                    <Spinner label="Counting changes" />
                  </span>
                ) : empty ? (
                  <span
                    {...stylex.props(
                      diffCountStyles.counts,
                      diffCountStyles.words,
                      styles.toggleCounts,
                    )}
                  >
                    0 files
                  </span>
                ) : (
                  <DiffCounts
                    progress={progress}
                    xstyle={styles.toggleCounts}
                  />
                )}
              </button>
              <ViewedButton
                progress={progress}
                disabled={lenses.busy || !!item.unavailable || !!item.pending}
                label={item.title}
                onClick={() => onMark(item.id)}
              />
            </div>
          </section>
        );
      })}
    </>
  );
}

// The lens list draws like the document: a new row lands in a slot and wipes
// in, a retitle recomposes the name, a removed row is erased and the list
// closes over it. Reduced motion shows each phase's finished frame. The row's
// wipe and erase share the document's keyframes in draw-styles.ts.
const landSlot = stylex.keyframes({
  "0%": {
    outline: `1px dashed ${tokens.ruleSoft}`,
    outlineOffset: "-1px",
    backgroundColor: tokens.transparent,
  },
  "38%": {
    outline: `1px solid ${tokens.accent}`,
    outlineOffset: "-1px",
    backgroundColor: tokens.markerTint,
  },
  "70%": {
    outline: `1px solid ${tokens.accent}`,
    backgroundColor: tokens.markerTint,
  },
  "100%": {
    outline: `1px solid ${tokens.transparent}`,
    outlineOffset: "-1px",
    backgroundColor: tokens.transparent,
  },
});

const attention = stylex.keyframes({
  from: {
    outlineColor: tokens.transparent,
    backgroundColor: tokens.transparent,
  },
});

const collapse = stylex.keyframes({
  from: { height: "auto", marginBlock: 0 },
  to: { height: 0, marginBlock: 0 },
});

const relabel = stylex.keyframes({
  from: { opacity: 0, clipPath: "inset(0 100% 0 0)" },
  to: { opacity: 1, clipPath: "inset(0 0 0 0)" },
});

/** Shared with the folded Diff sidebar's rail. */
export const lensRowStyles = stylex.create({
  // A lens with no changes (usually Uncategorized) has nothing to filter to.
  toggleEmpty: {
    color: tokens.inkFaint,
    cursor: "default",
    backgroundColor: tokens.transparent,
  },
  // The filter outranks the viewed fade; the checkbox beside it says viewed.
  faded: {
    opacity: 0.55,
  },
});

const styles = stylex.create({
  progress: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexShrink: 0,
    minHeight: "52px",
    padding: "0 14px 0 16px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    color: tokens.inkMuted,
    fontSize: fontSize.small,
  },
  progressLabel: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
  },
  ring: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    fontVariantNumeric: "tabular-nums",
  },
  hint: {
    padding: "0 14px 6px 16px",
    color: tokens.inkFaint,
    font: `${fontSize.small}/16px ${tokens.chromeFont}`,
  },
  section: {
    borderBottomWidth: 0,
    borderBottomStyle: "none",
    borderBottomColor: "currentcolor",
  },
  // The section wears no wash; the pressed toggle already says open.
  sectionExpanded: {
    backgroundColor: tokens.transparent,
  },
  row: {
    display: "flex",
    alignItems: "center",
    paddingRight: "10px",
    gap: "7px",
  },
  toggle: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: "8px",
    textAlign: "left",
    padding: "3px 4px 3px 8px",
    color: "inherit",
    cursor: "pointer",
    backgroundColor: { default: tokens.transparent, ":hover": tokens.well },
  },
  // Lines the name up with the sidebar's other rows.
  toggleInset: { paddingLeft: "18px" },
  insetStart: { paddingLeft: "26px" },
  progressInset: {
    minHeight: 0,
    gap: "6px",
    padding: 0,
    borderBottomWidth: 0,
    fontSize: fontSize.body,
  },
  toggleActive: {
    color: tokens.ink,
    fontWeight: fontWeight.semibold,
    backgroundColor: tokens.transparent,
  },
  toggleCounts: {
    marginLeft: "auto",
  },
  // A selected lens is a filter chip around its name and clear mark; the
  // counts stay outside it so they keep their column.
  chip: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: "8px",
    height: "24px",
    padding: "0 8px",
  },
  chipActive: { paddingRight: "4px" },
  name: {
    minWidth: 0,
    flex: "0 1 auto",
    lineHeight: 1.5,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  nameRelabel: {
    animationName: { default: relabel, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.stroke,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "steps(14)",
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  clear: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    borderRadius: radius.pill,
    backgroundColor: {
      default: null,
      [stylex.when.ancestor(":hover", lensChipMarker)]: tokens.markerGlow,
    },
  },
  // The kit's × drawn 6px across at a 1.4px line.
  clearMark: { width: "14px", height: "14px", strokeWidth: "2.4px" },
});

const sectionMotion = stylex.create({
  queued: {
    visibility: "hidden",
  },
  landing: {
    animationName: { default: landSlot, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.lensLand,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: motion.enter,
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  attention: {
    outline: `1px solid ${tokens.accent}`,
    outlineOffset: "-1px",
    backgroundColor: tokens.markerTint,
    animationName: { default: attention, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.ring,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "ease-out",
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  erasing: {
    overflow: "clip",
    interpolateSize: "allow-keywords",
    animationName: { default: collapse, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.beat,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: motion.enter,
      [stylex.env.reducedMotion]: "ease",
    },
    animationDelay: {
      default: drawMotion.rowErase,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
    display: { default: null, [stylex.env.reducedMotion]: "none" },
  },
});

export const sectionMotionStyle = (phase: string) =>
  phase === "queued" ||
  phase === "landing" ||
  phase === "attention" ||
  phase === "erasing"
    ? sectionMotion[phase]
    : null;
