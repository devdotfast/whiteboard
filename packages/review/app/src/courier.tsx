import type { LeaseScope } from "@review/review-api/activity";
import * as stylex from "@stylexjs/stylex";
import {
  type Context,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AuthoringActivityContext } from "./authoring-activity";
import {
  type AuthoringCursor,
  scopeFocus,
  scopeLive,
} from "./authoring-cursor";
import { CourierFigure } from "./courier-figure";
import { cursorElement } from "./cursor-element";
import { courierMarker } from "./markers.stylex";
import { useReviewRoots } from "./review-root-context";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";

/** The cursor for the document on screen; undefined while viewing history. */
export const AuthoringCursorContext = createContext<
  AuthoringCursor | null | undefined
>(undefined);

/** The cursor for the lenses on the Diffs page; undefined while viewing
 * history. */
export const LensCursorContext = createContext<
  AuthoringCursor | null | undefined
>(undefined);

export const cursorContext = (
  scope: LeaseScope,
): Context<AuthoringCursor | null | undefined> =>
  scope === "lenses" ? LensCursorContext : AuthoringCursorContext;

/** The lens row a lens cursor names, when it is on screen. */
export function lensRowElement(
  container: HTMLElement,
  cursor: AuthoringCursor,
): Element | null {
  const quoted = `"${cursor.targetId.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const row = container.querySelector(`[data-lens-id=${quoted}]`);

  return row?.getClientRects().length ? row : null;
}

const HOP_MS = 340;

const JUMP_MS = 540;

const LEAVE_MS = 440;

const SIT_AFTER_MS = 3000;

/** Where he stands on an element: its top edge, centered on a small thing,
 * a little in from the left on a wide one. A container that scrolls (the
 * lens list) carries him with its content. */
function standingPoint(target: DOMRect, container: HTMLElement) {
  const box = container.getBoundingClientRect();

  return {
    x:
      target.left -
      box.left +
      container.scrollLeft +
      Math.min(target.width / 2, 96),
    y: target.top - box.top + container.scrollTop,
  };
}

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

type Idle = "none" | "march" | "sit";

/**
 * Stands on whatever the cursor names, hops when it moves, marches in place
 * while the lease is live and nothing is arriving, sits down after a while,
 * and hops up and out when the lease ends. Click him and he jumps. He is
 * absolutely positioned inside his container and measured against it, so
 * scrolling costs nothing; layout changes re-measure him.
 *
 * The document's courier lives in the article and follows the document
 * lease; the lenses' courier lives in the Diffs page's lens list and follows
 * the lenses lease. Both can be out at once.
 */
export function Courier({
  scope = "document",
  container,
  find = cursorElement,
}: {
  scope?: LeaseScope;
  /** Where he stands, once mounted; the document article by default. */
  container?: HTMLElement | null;
  find?: (container: HTMLElement, cursor: AuthoringCursor) => Element | null;
}) {
  const roots = useReviewRoots();
  const activity = useContext(AuthoringActivityContext);
  const cursor = useContext(cursorContext(scope));
  const node = useRef<HTMLDivElement>(null);

  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  const [motion, setMotion] = useState<
    "hopping" | "jumping" | "leaving" | null
  >(null);

  const [idle, setIdle] = useState<Idle>("none");
  const [gone, setGone] = useState(false);

  const live = scopeLive(activity, scope);

  const unknown = activity === "unknown";

  // Follow the cursor: resolve its element, measure, and keep measuring
  // while the document reflows around it. No cursor, no courier.
  useLayoutEffect(() => {
    const article =
      container === undefined ? roots?.articleRef.current : container;

    if (!article || !cursor || gone) {
      setPosition(null);
      arrival.current = null;

      return;
    }

    let frame = 0;

    const measure = () => {
      frame = 0;
      const element = find(article, cursor);

      if (!element) return;

      const next = standingPoint(element.getBoundingClientRect(), article);

      setPosition((current) => {
        if (
          current &&
          Math.abs(current.x - next.x) < 1 &&
          Math.abs(current.y - next.y) < 1
        )
          return current;

        return next;
      });
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    const resize = new ResizeObserver(schedule);
    resize.observe(article);
    const mutation = new MutationObserver(schedule);
    mutation.observe(article, { childList: true, subtree: true });

    return () => {
      resize.disconnect();
      mutation.disconnect();

      if (frame) cancelAnimationFrame(frame);
    };
  }, [roots, container, cursor, gone, find]);

  // A new cursor is a hop; the same spot re-measured after a reflow is a
  // slide. The first placement is neither.
  const arrival = useRef<{ x: number; y: number } | null>(null);
  const hopped = useRef<number>(undefined);

  useEffect(() => {
    if (!position || !cursor) return;
    const from = arrival.current;
    arrival.current = position;

    if (!from) {
      hopped.current = cursor.seq;

      return;
    }

    if (hopped.current === cursor.seq) return;
    const distance = Math.hypot(position.x - from.x, position.y - from.y);

    // The cursor moved but the spot has not yet: the measurement follows.
    if (distance < 1) return;
    hopped.current = cursor.seq;

    if (reducedMotion()) return;
    node.current?.style.setProperty(
      "--courier-arc",
      `${Math.min(72, 18 + distance * 0.28)}px`,
    );
    setIdle("none");
    setMotion("hopping");

    const timer = setTimeout(
      () => setMotion((current) => (current === "hopping" ? null : current)),
      HOP_MS,
    );

    return () => clearTimeout(timer);
  }, [position, cursor]);

  // With nothing arriving he marches, then sits.
  useEffect(() => {
    if (!live || motion === "hopping" || motion === "leaving" || gone) return;
    setIdle("march");
    const timer = setTimeout(() => setIdle("sit"), SIT_AFTER_MS);

    return () => clearTimeout(timer);
  }, [live, motion, cursor?.seq, gone]);

  // The lease ended: one last hop up and out, then nothing.
  useEffect(() => {
    if (live || activity === undefined || unknown || !position || gone) return;
    setIdle("none");
    setMotion("leaving");

    const timer = setTimeout(
      () => {
        setGone(true);
        setMotion(null);
        setPosition(null);
        arrival.current = null;
      },
      reducedMotion() ? 0 : LEAVE_MS,
    );

    return () => clearTimeout(timer);
  }, [live, unknown, activity === undefined, Boolean(position), gone]);

  // A lease that begins again brings him back.
  useEffect(() => {
    if (live && gone) setGone(false);
  }, [live, gone]);

  const jump = () => {
    if (reducedMotion() || motion === "leaving") return;
    setMotion(null);
    requestAnimationFrame(() => setMotion("jumping"));
    setTimeout(() => setMotion((m) => (m === "jumping" ? null : m)), JUMP_MS);
  };

  if (!position || gone || activity === undefined) return null;

  const description =
    activity !== "unknown"
      ? scopeFocus(activity, scope)?.description
      : undefined;

  // The classes are markers: the badge finds him by them, and tests read
  // his tag.
  return (
    <div
      ref={node}
      {...withClass("courier", styles.courier, unknown && styles.unknown)}
      data-scope={scope}
      data-state={unknown ? "unknown" : live ? "live" : "ended"}
      data-idle={idle}
      data-motion={motion ?? undefined}
      style={{ left: position.x, top: position.y }}
      aria-hidden={unknown || undefined}
    >
      <button
        type="button"
        {...withClass("courier-figure", courierMarker, styles.figure)}
        aria-label={
          description
            ? `The agent's courier: ${description}. Press to make him jump.`
            : "The agent's courier. Press to make him jump."
        }
        onClick={jump}
      >
        {description && (
          <span {...withClass("courier-tag", styles.tag)} aria-hidden="true">
            {description}
          </span>
        )}
        <span
          {...stylex.props(
            styles.arc,
            motion === "hopping" && styles.hopArc,
            motion === "jumping" && styles.jumpArc,
            motion === "leaving" && styles.leave,
          )}
        >
          <span
            {...stylex.props(
              styles.body,
              idle === "sit" && styles.sitting,
              unknown && styles.slumped,
              idle === "march"
                ? styles.bob
                : motion === "hopping"
                  ? styles.squash
                  : motion === "jumping" && styles.jumpSquash,
            )}
          >
            <CourierFigure
              xstyle={styles.figureSvg}
              pose={{ idle, jumping: motion === "jumping" }}
            />
          </span>
        </span>
        <span
          {...stylex.props(
            styles.shadow,
            motion === "hopping" && styles.hopShadow,
            motion === "jumping" && styles.jumpShadow,
          )}
        />
      </button>
    </div>
  );
}

const REDUCED = "@media (prefers-reduced-motion: reduce)";

const inDiffWorkspace = ":is(.diff-workspace *)";

// The hop: the wrapper slides, the arc lifts, the body squashes on landing.

const hopArc = stylex.keyframes({
  "0%": { transform: "translateY(0)" },
  "45%": { transform: "translateY(calc(var(--courier-arc, 40px) * -1))" },
  "100%": { transform: "translateY(0)" },
});

const hopSquash = stylex.keyframes({
  "0%": { transform: "scale(1.1, 0.9)" },
  "30%": { transform: "scale(0.92, 1.1)" },
  "76%": { transform: "scale(0.92, 1.06)" },
  "84%": { transform: "scale(1.14, 0.84)" },
  "100%": { transform: "scale(1, 1)" },
});

const hopShadow = stylex.keyframes({
  "0%": { transform: "scale(1)", opacity: 0.18 },
  "45%": { transform: "scale(0.6)", opacity: 0.08 },
  "100%": { transform: "scale(1)", opacity: 0.18 },
});

// The jump, on click: higher, with a wobble and happy eyes.

const jumpArc = stylex.keyframes({
  "0%": { transform: "translateY(0)" },
  "50%": { transform: "translateY(-58px)" },
  "100%": { transform: "translateY(0)" },
});

const jumpSquash = stylex.keyframes({
  "0%": { transform: "scale(1.25, 0.7)" },
  "18%": { transform: "scale(0.82, 1.24) rotate(-6deg)" },
  "50%": { transform: "scale(0.9, 1.1) rotate(6deg)" },
  "80%": { transform: "scale(0.9, 1.06) rotate(0)" },
  "88%": { transform: "scale(1.22, 0.76)" },
  "100%": { transform: "scale(1, 1)" },
});

const jumpShadow = stylex.keyframes({
  "0%": { transform: "scale(1)", opacity: 0.18 },
  "50%": { transform: "scale(0.45)", opacity: 0.05 },
  "100%": { transform: "scale(1)", opacity: 0.18 },
});

const marchBob = stylex.keyframes({
  "0%, 100%": { transform: "translateY(0) rotate(-2deg)" },
  "50%": { transform: "translateY(-1.5px) rotate(2deg)" },
});

// The lease ended: up and out.

const leave = stylex.keyframes({
  "0%": { transform: "translateY(0)" },
  "25%": { transform: "translateY(-10px)" },
  "100%": { transform: "translateY(-260px)", opacity: 0 },
});

// He stands on the top edge of whatever the cursor names and slides when it
// reflows. Reduced motion keeps him and drops the hops.
const styles = stylex.create({
  courier: {
    position: "absolute",
    zIndex: 4,
    width: "32px",
    height: "39px",
    margin: "-39px 0 0 -16px",
    color: tokens.accent,
    pointerEvents: "none",
    transition: {
      default: "left 260ms linear, top 260ms linear",
      [REDUCED]: "none",
    },
  },
  // Unknown: grey and slumped, no motion.
  unknown: {
    color: tokens.inkFaint,
  },
  figure: {
    position: "relative",
    display: "block",
    width: "100%",
    height: "100%",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: { default: null, ":focus-visible": "8px" },
    backgroundColor: "transparent",
    backgroundImage: "none",
    color: "inherit",
    cursor: "pointer",
    pointerEvents: "auto",
    // In the lens list the diff workspace's button focus ring wins.
    outline: {
      default: null,
      ":focus-visible": {
        default: `2px solid ${tokens.accent}`,
        [inDiffWorkspace]: `1px solid ${tokens.accent}`,
      },
    },
    outlineOffset: {
      default: null,
      ":focus-visible": { default: "4px", [inDiffWorkspace]: "-2px" },
    },
  },
  figureSvg: {
    display: "block",
    width: "100%",
    height: "100%",
    overflow: "visible",
  },
  tag: {
    position: "absolute",
    top: "-20px",
    left: "50%",
    padding: "2px 7px",
    borderRadius: "999px",
    backgroundColor: tokens.ink,
    color: tokens.surface,
    font: `500 10px ${tokens.fontMono}`,
    whiteSpace: "nowrap",
    transform: "translateX(-50%)",
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", courierMarker)]: 1,
      [stylex.when.ancestor(":focus-visible", courierMarker)]: 1,
      [REDUCED]: 1,
    },
    transition: "opacity 150ms ease",
    pointerEvents: "none",
  },
  arc: {
    display: "block",
    width: "100%",
    height: "100%",
    transition: { default: null, [REDUCED]: "none" },
  },
  hopArc: {
    animationName: { default: hopArc, [REDUCED]: "none" },
    animationDuration: { default: "260ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: "ease-out", [REDUCED]: "ease" },
  },
  jumpArc: {
    animationName: { default: jumpArc, [REDUCED]: "none" },
    animationDuration: { default: "420ms", [REDUCED]: "0s" },
    animationTimingFunction: {
      default: "cubic-bezier(0.3, 0, 0.2, 1)",
      [REDUCED]: "ease",
    },
  },
  leave: {
    animationName: { default: leave, [REDUCED]: "none" },
    animationDuration: { default: "420ms", [REDUCED]: "0s" },
    animationTimingFunction: {
      default: "cubic-bezier(0.4, 0, 1, 1)",
      [REDUCED]: "ease",
    },
    animationFillMode: { default: "forwards", [REDUCED]: "none" },
  },
  body: {
    display: "block",
    width: "100%",
    height: "100%",
    transformOrigin: "50% 100%",
    transition: { default: null, [REDUCED]: "none" },
  },
  // Sitting eases in, reduced motion included.
  sitting: {
    transform: "translateY(7px)",
    transition: "transform 300ms ease",
  },
  slumped: {
    transform: "translateY(2px) rotate(-8deg)",
  },
  squash: {
    animationName: { default: hopSquash, [REDUCED]: "none" },
    animationDuration: { default: "340ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: "ease-out", [REDUCED]: "ease" },
  },
  jumpSquash: {
    animationName: { default: jumpSquash, [REDUCED]: "none" },
    animationDuration: { default: "520ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: "ease-out", [REDUCED]: "ease" },
  },
  bob: {
    animationName: { default: marchBob, [REDUCED]: "none" },
    animationDuration: { default: "480ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: "ease-in-out", [REDUCED]: "ease" },
    animationIterationCount: { default: "infinite", [REDUCED]: 1 },
  },
  shadow: {
    position: "absolute",
    bottom: "-3px",
    left: "50%",
    width: "18px",
    height: "4px",
    marginLeft: "-9px",
    borderRadius: "50%",
    backgroundColor: tokens.ink,
    opacity: 0.18,
    transition: { default: null, [REDUCED]: "none" },
  },
  hopShadow: {
    animationName: { default: hopShadow, [REDUCED]: "none" },
    animationDuration: { default: "260ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: "ease-out", [REDUCED]: "ease" },
  },
  jumpShadow: {
    animationName: { default: jumpShadow, [REDUCED]: "none" },
    animationDuration: { default: "420ms", [REDUCED]: "0s" },
    animationTimingFunction: {
      default: "cubic-bezier(0.3, 0, 0.2, 1)",
      [REDUCED]: "ease",
    },
  },
});
