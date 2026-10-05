import { courierMotion } from "@canvas/courier-motion.stylex";
import { fontSize, fontWeight, motion, radius } from "@canvas/scale.stylex";
import type { ActivityPresence } from "@review/review-api/activity";
import * as stylex from "@stylexjs/stylex";
import { useContext, useState } from "react";

import { agentColor } from "./agent-colors";
import { AuthoringActivityContext } from "./authoring-activity-context";
import { surfaceOf } from "./authoring-cursor";
import {
  AuthoringCursorContext,
  LensCursorContext,
  lensRowElement,
} from "./courier";
import { CourierFigure } from "./courier-figure";
import { cursorElement } from "./cursor-element";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { topbarTabsMarker } from "./markers.stylex";
import { useReviewRoots } from "./review-root-context";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { useTooltip } from "./use-tooltip";

/**
 * The top-bar badges: one pill per working agent, in its color, with its
 * mini courier and what it is doing. Clicking one opens the page where that
 * agent last wrote (the Review surface, or the Diffs page for lenses); when
 * its courier is on the board, it also takes the reader to him, and he jumps
 * so the eye finds him.
 */
export function AuthoringActivityBadge({
  onLocate,
}: {
  /** Show the surface (before scrolling to its courier, if any). */
  onLocate?(view: "review" | "diff"): void;
}) {
  const activity = useContext(AuthoringActivityContext);

  const tooltip = useTooltip<HTMLElement>(
    "Activity updates stopped. This does not mean the agent finished.",
  );

  if (!activity) return null;

  // The class is a marker for tests.
  if (activity === "unknown")
    return (
      <span
        {...withClass("host-authoring-activity", styles.badge)}
        role="status"
        aria-live="polite"
        ref={tooltip}
      >
        <CourierFigure xstyle={styles.courier} />
        <span {...stylex.props(styles.text)}>Activity unknown</span>
      </span>
    );

  return (activity.activities ?? []).map((presence) => (
    <AgentPill
      key={presence.activityId}
      presence={presence}
      onLocate={onLocate}
    />
  ));
}

function AgentPill({
  presence,
  onLocate,
}: {
  presence: ActivityPresence;
  onLocate?(view: "review" | "diff"): void;
}) {
  const documentCursor = useContext(AuthoringCursorContext);
  const lensCursor = useContext(LensCursorContext);
  const roots = useReviewRoots();

  const toLenses = surfaceOf(presence) === "lenses";
  const cursor = toLenses ? lensCursor : documentCursor;
  const description = presence.focus?.description;
  const text = description || "Agent working…";

  const tooltip = useTooltip<HTMLElement>(
    `${description || "An agent has reported ongoing authoring work. This signal expires if updates stop."}${cursor ? " · Click to go to the courier." : ""}`,
  );

  const locate = () => {
    onLocate?.(toLenses ? "diff" : "review");

    if (!cursor) return;

    // The surface may only be showing now; measure after it paints.
    requestAnimationFrame(() => {
      const container = toLenses
        ? roots?.appRef.current?.querySelector<HTMLElement>(
            ".diff-sidebar-lenses",
          )
        : roots?.articleRef.current;

      if (!container) return;

      const target = (toLenses ? lensRowElement : cursorElement)(
        container,
        cursor,
      );

      if (!target) return;
      target.scrollIntoView?.({ block: "center", behavior: "smooth" });
      container
        .querySelector<HTMLButtonElement>(
          `.courier[data-scope="${toLenses ? "lenses" : "document"}"] .courier-figure`,
        )
        ?.click();
    });
  };

  return (
    <button
      type="button"
      {...withClass(
        "host-authoring-activity",
        styles.badge,
        styles.badgeActive,
        agentColor(presence.slot),
      )}
      data-active
      data-locatable
      aria-label={cursor ? `${text}. Go to the courier.` : undefined}
      ref={tooltip}
      onClick={locate}
    >
      <CourierFigure xstyle={[styles.courier, styles.courierActive]} marching />
      <span {...stylex.props(styles.text)} role="status" aria-live="polite">
        {text}
      </span>
    </button>
  );
}

/**
 * The word "Whiteboard" in the top bar's surface tabs. While an agent is writing,
 * marker ink sweeps through the word. The document is ready once it has
 * content and no agent is working, so the last agent ending (or expiring) is
 * what finishes it. When it becomes ready while the reader is on another
 * surface, an unread dot sits just past the word until they visit the tab, and
 * it comes back only when a later version arrives while they are elsewhere
 * again. A document that is already ready when this mounts counts as read.
 * Neither state changes the tab's layout box.
 */
export function ReviewSurfaceLabel({
  hasContent,
  active,
  label = "Whiteboard",
}: {
  hasContent: boolean;
  active: boolean;
  /** The tab's word; the scratchpad names itself. */
  label?: string;
}) {
  const activity = useContext(AuthoringActivityContext);
  const version = useContext(DisplayedReviewVersionContext) ?? null;

  // Any working agent, on the document or lenses, means the review is not ready yet.
  const live =
    activity !== undefined &&
    activity !== "unknown" &&
    activity.workingCount > 0;

  const ready = hasContent && !live;

  const [readVersion, setReadVersion] = useState<number | null>(() =>
    active || ready ? version : null,
  );

  if (active && readVersion !== version) setReadVersion(version);
  const unread = !active && ready && readVersion !== version;

  return (
    <span
      {...stylex.props(
        styles.word,
        live && styles.wordWorking,
        live && active && styles.wordWorkingActive,
      )}
      data-working={live || undefined}
    >
      {label}
      {unread && <span {...stylex.props(styles.unread)} aria-hidden="true" />}
    </span>
  );
}

const REDUCED = "@media (prefers-reduced-motion: reduce)";

// The surface tab's word is styled only in the top bar's tabs.
const inTopbarTabs = () => stylex.when.ancestor(":is(*)", topbarTabsMarker);

const shimmer = stylex.keyframes({
  from: { backgroundPosition: "120% 0" },
  to: { backgroundPosition: "-120% 0" },
});

const courierArrive = stylex.keyframes({
  "0%": { transform: "translateY(-16px)", opacity: 0 },
  "70%": { transform: "translateY(2px) scale(1.1, 0.9)", opacity: 1 },
  "100%": { transform: "none" },
});

const mutedInk = `linear-gradient(100deg, ${tokens.inkMuted} 0 40%, ${tokens.accent} 50%, ${tokens.inkMuted} 60% 100%)`;

const strongInk = `linear-gradient(100deg, ${tokens.ink} 0 40%, ${tokens.accent} 50%, ${tokens.ink} 60% 100%)`;

const styles = stylex.create({
  badge: {
    display: "inline-flex",
    flex: "0 1 auto",
    minWidth: 0,
    maxWidth: "420px",
    alignItems: "center",
    gap: "7px",
    height: tokens.chromeControlHeight,
    marginInline: "4px",
    padding: "0 10px 0 6px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: radius.pill,
    backgroundColor: tokens.transparent,
    color: tokens.inkMuted,
    font: `${fontWeight.medium} ${fontSize.small} ${tokens.fontMono}`,
    whiteSpace: "nowrap",
  },
  // While an agent works the badge is a button that locates the courier.
  badgeActive: {
    cursor: "pointer",
    backgroundColor: {
      default: tokens.markerTint,
      ":hover": tokens.markerGlow,
    },
    color: tokens.accent,
    fontWeight: fontWeight.semibold,
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
  // A long update ends in an ellipsis inside the pill; the tooltip has it all.
  text: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  courier: {
    flexShrink: 0,
    width: "16px",
    height: "20px",
    overflow: "visible",
    color: tokens.inkFaint,
    transform: "translateY(2px) rotate(-8deg)",
  },
  // Arriving: the mini courier drops in when an agent begins.
  courierActive: {
    color: tokens.accent,
    transform: "none",
    animationName: { default: courierArrive, [REDUCED]: "none" },
    animationDuration: {
      default: courierMotion.arrive,
      [REDUCED]: motion.instant,
    },
    animationTimingFunction: {
      default: "cubic-bezier(0.2, 0.7, 0.2, 1)",
      [REDUCED]: "ease",
    },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  // Neither the ink nor the unread dot touches the tab's layout: the dot is
  // out of flow and only color moves.
  word: {
    position: { default: null, [inTopbarTabs()]: "relative" },
  },
  // Marker ink sweeps through the word while the agent writes.
  wordWorking: {
    backgroundImage: {
      default: null,
      [inTopbarTabs()]: { default: mutedInk, [REDUCED]: "none" },
    },
    backgroundSize: {
      default: null,
      [inTopbarTabs()]: { default: "240% 100%", [REDUCED]: "auto" },
    },
    backgroundClip: {
      default: null,
      [inTopbarTabs()]: { default: "text", [REDUCED]: "border-box" },
    },
    color: {
      default: null,
      [inTopbarTabs()]: {
        default: tokens.transparent,
        [REDUCED]: tokens.inkMuted,
      },
    },
    animationName: {
      default: null,
      [inTopbarTabs()]: { default: shimmer, [REDUCED]: "none" },
    },
    animationDuration: {
      default: null,
      [inTopbarTabs()]: { default: motion.pulse, [REDUCED]: motion.instant },
    },
    animationTimingFunction: {
      default: null,
      [inTopbarTabs()]: { default: "linear", [REDUCED]: "ease" },
    },
    animationIterationCount: {
      default: null,
      [inTopbarTabs()]: { default: "infinite", [REDUCED]: 1 },
    },
  },
  // The chosen tab inks darker, reduced motion included.
  wordWorkingActive: {
    backgroundImage: { default: null, [inTopbarTabs()]: strongInk },
  },
  unread: {
    position: { default: null, [inTopbarTabs()]: "absolute" },
    top: { default: null, [inTopbarTabs()]: "1px" },
    right: { default: null, [inTopbarTabs()]: "-7px" },
    width: { default: null, [inTopbarTabs()]: "4px" },
    height: { default: null, [inTopbarTabs()]: "4px" },
    borderRadius: { default: null, [inTopbarTabs()]: radius.round },
    backgroundColor: { default: null, [inTopbarTabs()]: tokens.accent },
  },
});
