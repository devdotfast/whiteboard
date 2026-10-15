import { drawDelay, drawMotion } from "@canvas/draw-motion.stylex";
import { motion, radius } from "@canvas/scale.stylex";
import * as stylex from "@stylexjs/stylex";

import { documentNodeMarker } from "./markers.stylex";
import { tokens } from "./tokens.stylex";

// Drawing (study 05). Each accepted edit is drawn as it lands, one at a time,
// from the draw queue in draw-queue.ts; the courier stands on the one being
// drawn. Blocks and units carry `data-motion` for their phase. Outline first,
// then fill: a new flow node is traced clockwise from its top-left on its real
// geometry (pathLength=1 on the rect), pulses once, and its label composes; an
// edge is one stroke from source to target; a new block gets a slot, then
// wipes in behind the marker dot; a rewritten block is erased in three
// diagonal passes and rewritten; the top-level block being edited wears the
// section ring. Queued content waits unseen so nothing lands twice. Reduced
// motion shows every phase as its finished frame.
//
// `--wb-wipe` and `--wb-sweep` are registered in global.css so they animate.

// A block's own elements: the children of a block in a phase.
const landingChild = ':is([data-review-node-id][data-motion="landing"] > *)';

const rewritingChild =
  ':is([data-review-node-id][data-motion="rewriting"] > *)';

const erasingChild = ':is([data-review-node-id][data-motion="erasing"] > *)';

// A top-level section wears the ring on its own box, not the block's outline.
const ringOnSection = ":is([data-region]):has(> .review-section)";

// The section a top-level block renders.
const regionOff = ':is([data-review-node-id][data-region="off"] > *)';

const regionOn =
  ':is([data-review-node-id]:is([data-region="writing"], [data-region="idle"]) > *)';

const regionWriting = ':is([data-review-node-id][data-region="writing"] > *)';

// SAFETY: StyleX compiles custom properties in keyframes; only its types
// omit them.
const wipe = stylex.keyframes({
  from: { "--wb-wipe": "0%" } as stylex.CSSProperties,
  to: { "--wb-wipe": "108%" } as stylex.CSSProperties,
});

const sweepMask = `linear-gradient(115deg, transparent calc(var(--wb-sweep) - 12%), #000 var(--wb-sweep))`;

// SAFETY: as for the wipe, the sweep is a custom property.
const erase = stylex.keyframes({
  from: {
    "--wb-sweep": "-20%",
    opacity: 1,
    WebkitMaskImage: sweepMask,
    maskImage: sweepMask,
  } as stylex.CSSProperties,
  to: {
    "--wb-sweep": "130%",
    opacity: 1,
    WebkitMaskImage: sweepMask,
    maskImage: sweepMask,
  } as stylex.CSSProperties,
});

const rewrite = stylex.keyframes({
  from: { clipPath: "inset(0 100% 0 0)" },
  to: { clipPath: "inset(0 0 0 0)" },
});

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

const dotFade = stylex.keyframes({
  from: { opacity: 1 },
  to: { opacity: 0 },
});

const eraserIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateX(-60px) rotate(-6deg)" },
  to: { opacity: 1, transform: "translateX(0) rotate(-6deg)" },
});

const eraserSweeps = stylex.keyframes({
  "0%": { transform: "translate(0, 0) rotate(-6deg)" },
  "33%": { transform: "translate(520px, 22px) rotate(-8deg)" },
  "34%": { transform: "translate(30px, 26px) rotate(-6deg)" },
  "66%": { transform: "translate(540px, 50px) rotate(-8deg)" },
  "67%": { transform: "translate(60px, 54px) rotate(-6deg)" },
  "100%": { transform: "translate(560px, 78px) rotate(-8deg)" },
});

const eraserOut = stylex.keyframes({
  to: { opacity: 0, transform: "translate(600px, 88px) rotate(-8deg)" },
});

const collapse = stylex.keyframes({
  from: { height: "auto", marginBlock: 0 },
  to: { height: 0, marginBlock: 0 },
});

const regionPulse = stylex.keyframes({
  "50%": {
    outlineColor: `color-mix(in srgb, ${tokens.accent} 25%, transparent)`,
  },
});

const regionPulseBorder = stylex.keyframes({
  "50%": {
    borderColor: `color-mix(in srgb, ${tokens.accent} 25%, transparent)`,
  },
});

const label = stylex.keyframes({
  from: { opacity: 0, clipPath: "inset(0 100% 0 0)" },
  to: { opacity: 1, clipPath: "inset(0 0 0 0)" },
});

const trace = stylex.keyframes({
  from: { strokeDashoffset: "1" },
  to: { strokeDashoffset: "0" },
});

const nodeFill = stylex.keyframes({
  "0%": {
    fill: tokens.markerTint,
    stroke: tokens.accent,
    strokeWidth: "1.6",
  },
  "60%": { fill: tokens.markerTint, stroke: tokens.accent },
  "100%": { strokeWidth: "1" },
});

const stepPop = stylex.keyframes({
  "0%": {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    boxShadow: `0 0 0 0 ${tokens.markerGlow}`,
  },
  "40%": { boxShadow: `0 0 0 8px ${tokens.markerGlow}` },
  "100%": {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
    boxShadow: `0 0 0 0 ${tokens.transparent}`,
  },
});

// A block's own elements while it is drawn. Reduced motion stops them (the
// finished frame); an erased block's content stays gone.
const childAnimationName = {
  [landingChild]: { default: wipe, [stylex.env.reducedMotion]: "none" },
  [rewritingChild]: {
    default: `${erase}, ${rewrite}`,
    [stylex.env.reducedMotion]: "none",
  },
  [erasingChild]: { default: erase, [stylex.env.reducedMotion]: "none" },
};

const childAnimationDuration = {
  [landingChild]: { default: "420ms", [stylex.env.reducedMotion]: "0s" },
  [rewritingChild]: {
    default: "400ms, 500ms",
    [stylex.env.reducedMotion]: "0s",
  },
  [erasingChild]: { default: "400ms", [stylex.env.reducedMotion]: "0s" },
};

const childAnimationTimingFunction = {
  [landingChild]: { default: motion.enter, [stylex.env.reducedMotion]: "ease" },
  [rewritingChild]: {
    default: `linear, ${motion.enter}`,
    [stylex.env.reducedMotion]: "ease",
  },
  [erasingChild]: { default: "linear", [stylex.env.reducedMotion]: "ease" },
};

const childAnimationDelay = {
  [landingChild]: { default: "260ms", [stylex.env.reducedMotion]: "0s" },
  [rewritingChild]: {
    default: "200ms, 600ms",
    [stylex.env.reducedMotion]: "0s",
  },
  [erasingChild]: { default: "0s", [stylex.env.reducedMotion]: "0s" },
};

const childAnimationFillMode = {
  [landingChild]: { default: "both", [stylex.env.reducedMotion]: "none" },
  [rewritingChild]: {
    default: "both, both",
    [stylex.env.reducedMotion]: "none",
  },
  [erasingChild]: { default: "forwards", [stylex.env.reducedMotion]: "none" },
};

const childAnimationList = {
  [rewritingChild]: { default: "1, 1", [stylex.env.reducedMotion]: "1" },
};

const childAnimationDirection = {
  [rewritingChild]: {
    default: "normal, normal",
    [stylex.env.reducedMotion]: "normal",
  },
};

const childAnimationPlayState = {
  [rewritingChild]: {
    default: "running, running",
    [stylex.env.reducedMotion]: "running",
  },
};

const wipeMask = `linear-gradient(90deg, #000 calc(${tokens.wbWipe} - 8%), transparent ${tokens.wbWipe})`;

// The eraser: a flat well-gray block that lands and makes three diagonal
// passes.
const eraser = {
  content: "''",
  position: "absolute",
  top: "4px",
  left: 0,
  width: "44px",
  height: "18px",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: tokens.ruleSoft,
  borderRadius: "3px",
  backgroundColor: tokens.well,
  opacity: 0,
  pointerEvents: "none",
  display: { default: null, [stylex.env.reducedMotion]: "none" },
  animationName: {
    default: `${eraserIn}, ${eraserSweeps}, ${eraserOut}`,
    [stylex.env.reducedMotion]: "none",
  },
  animationIterationCount: {
    default: "1, 1, 1",
    [stylex.env.reducedMotion]: "1",
  },
  animationDirection: {
    default: "normal, normal, normal",
    [stylex.env.reducedMotion]: "normal",
  },
  animationPlayState: {
    default: "running, running, running",
    [stylex.env.reducedMotion]: "running",
  },
  animationFillMode: {
    default: "both, both, both",
    [stylex.env.reducedMotion]: "none",
  },
  animationTimingFunction: {
    default: `${motion.enter}, linear, ease`,
    [stylex.env.reducedMotion]: "ease",
  },
};

export const drawStyles = stylex.create({
  // Every element a block renders as its own: the content wipes in behind
  // the dot, is erased and rewritten, or is erased for good. Opt-in: a new
  // block type must apply it to its root element or it skips these phases.
  blockChild: {
    WebkitMaskImage: {
      default: null,
      [landingChild]: { default: wipeMask, [stylex.env.reducedMotion]: "none" },
    },
    maskImage: {
      default: null,
      [landingChild]: { default: wipeMask, [stylex.env.reducedMotion]: "none" },
    },
    opacity: { default: null, [erasingChild]: 0 },
    animationName: { default: null, ...childAnimationName },
    animationDuration: { default: null, ...childAnimationDuration },
    animationTimingFunction: {
      default: null,
      ...childAnimationTimingFunction,
    },
    animationDelay: { default: null, ...childAnimationDelay },
    animationFillMode: { default: null, ...childAnimationFillMode },
    animationIterationCount: { default: null, ...childAnimationList },
    animationDirection: { default: null, ...childAnimationDirection },
    animationPlayState: { default: null, ...childAnimationPlayState },
  },
  queued: {
    visibility: "hidden",
  },
  // Landing: a dashed slot, then the content wipes in behind the dot while
  // the slot takes the marker wash and a solid outline; both fade on settle.
  landing: {
    position: "relative",
    borderRadius: radius.surface,
    "::after": {
      content: "''",
      position: "absolute",
      top: "50%",
      left: tokens.wbWipe,
      width: "8px",
      height: "8px",
      margin: "-4px 0 0 -4px",
      borderRadius: radius.round,
      backgroundColor: tokens.accent,
      boxShadow: `0 0 0 3px ${tokens.markerGlow}`,
      pointerEvents: "none",
      display: { default: null, [stylex.env.reducedMotion]: "none" },
      animationName: {
        default: `${wipe}, ${dotFade}`,
        [stylex.env.reducedMotion]: "none",
      },
      animationDuration: {
        default: `${drawMotion.stroke}, ${drawMotion.dotFade}`,
        [stylex.env.reducedMotion]: motion.instant,
      },
      animationTimingFunction: {
        default: `${motion.enter}, ease`,
        [stylex.env.reducedMotion]: "ease",
      },
      animationDelay: {
        default: drawDelay.dot,
        [stylex.env.reducedMotion]: motion.instant,
      },
      animationFillMode: {
        default: "both, both",
        [stylex.env.reducedMotion]: "none",
      },
      animationIterationCount: {
        default: "1, 1",
        [stylex.env.reducedMotion]: "1",
      },
      animationDirection: {
        default: "normal, normal",
        [stylex.env.reducedMotion]: "normal",
      },
      animationPlayState: {
        default: "running, running",
        [stylex.env.reducedMotion]: "running",
      },
    },
  },
  // Rewriting: the eraser lands and makes its passes; the text under it
  // drops away, then the new ink wipes in from the left.
  rewriting: {
    position: "relative",
    "::before": {
      ...eraser,
      animationDuration: {
        default: `${drawMotion.beat}, ${drawMotion.pass}, ${drawMotion.beat}`,
        [stylex.env.reducedMotion]: motion.instant,
      },
      animationDelay: {
        default: drawDelay.rewrite,
        [stylex.env.reducedMotion]: motion.instant,
      },
    },
  },
  // Erasing: the eraser's three passes, then the board closes over the gap.
  erasing: {
    position: "relative",
    display: { default: null, [stylex.env.reducedMotion]: "none" },
    overflow: "clip",
    interpolateSize: "allow-keywords",
    "::before": {
      ...eraser,
      animationDuration: {
        default: `${drawMotion.tick}, ${drawMotion.pass}, ${drawMotion.tick}`,
        [stylex.env.reducedMotion]: motion.instant,
      },
      animationDelay: {
        default: drawDelay.erase,
        [stylex.env.reducedMotion]: motion.instant,
      },
    },
  },
  // The section ring: the top-level block the agent is editing wears the
  // marker hairline, outside its content so nothing shifts, and no wash.
  // While the agent writes only its color breathes; idle, it holds; when the
  // agent moves on or stops, it fades.
  region: {
    borderRadius: radius.surface,
    outline: {
      default: `1px solid ${tokens.transparent}`,
      [ringOnSection]: "none",
    },
    outlineOffset: "12px",
    transition: `outline-color ${drawMotion.ring} ${motion.ease}`,
  },
  regionOn: {
    outline: { default: `1px solid ${tokens.accent}`, [ringOnSection]: "none" },
  },
  // A block's own animation.
  blockLand: {
    animationName: {
      default: landSlot,
      [ringOnSection]: "none",
      [stylex.env.reducedMotion]: "none",
      ...childAnimationName,
    },
    animationDuration: {
      default: drawMotion.land,
      [ringOnSection]: motion.instant,
      [stylex.env.reducedMotion]: motion.instant,
      ...childAnimationDuration,
    },
    animationTimingFunction: {
      default: motion.enter,
      [ringOnSection]: "ease",
      [stylex.env.reducedMotion]: "ease",
      ...childAnimationTimingFunction,
    },
    animationDelay: { default: null, ...childAnimationDelay },
    animationFillMode: {
      default: "both",
      [ringOnSection]: "none",
      [stylex.env.reducedMotion]: "none",
      ...childAnimationFillMode,
    },
    animationIterationCount: { default: null, ...childAnimationList },
    animationDirection: { default: null, ...childAnimationDirection },
    animationPlayState: { default: null, ...childAnimationPlayState },
  },
  blockCollapse: {
    animationName: {
      default: collapse,
      [ringOnSection]: "none",
      [stylex.env.reducedMotion]: "none",
      ...childAnimationName,
    },
    animationDuration: {
      default: drawMotion.collapse,
      [ringOnSection]: motion.instant,
      [stylex.env.reducedMotion]: motion.instant,
      ...childAnimationDuration,
    },
    animationTimingFunction: {
      default: motion.enter,
      [ringOnSection]: "ease",
      [stylex.env.reducedMotion]: "ease",
      ...childAnimationTimingFunction,
    },
    animationDelay: {
      default: drawMotion.pass,
      [ringOnSection]: motion.instant,
      [stylex.env.reducedMotion]: motion.instant,
      ...childAnimationDelay,
    },
    animationFillMode: {
      default: "both",
      [ringOnSection]: "none",
      [stylex.env.reducedMotion]: "none",
      ...childAnimationFillMode,
    },
    animationIterationCount: { default: null, ...childAnimationList },
    animationDirection: { default: null, ...childAnimationDirection },
    animationPlayState: { default: null, ...childAnimationPlayState },
  },
  blockPulse: {
    animationName: {
      default: regionPulse,
      [ringOnSection]: "none",
      [stylex.env.reducedMotion]: "none",
      ...childAnimationName,
    },
    animationDuration: {
      default: motion.pulse,
      [ringOnSection]: motion.instant,
      [stylex.env.reducedMotion]: motion.instant,
      ...childAnimationDuration,
    },
    animationTimingFunction: {
      default: "ease-in-out",
      [ringOnSection]: "ease",
      [stylex.env.reducedMotion]: "ease",
      ...childAnimationTimingFunction,
    },
    animationDelay: { default: null, ...childAnimationDelay },
    animationFillMode: { default: null, ...childAnimationFillMode },
    animationIterationCount: {
      default: "infinite",
      [ringOnSection]: "1",
      [stylex.env.reducedMotion]: "1",
      ...childAnimationList,
    },
    animationDirection: { default: null, ...childAnimationDirection },
    animationPlayState: { default: null, ...childAnimationPlayState },
  },
  // A top-level section's ring, on its own box: its chevron hangs 28px left
  // of its heading, past the 12px offset, so an outline would cut through
  // it. The box reaches 12px past the chevron on the left.
  sectionRing: {
    "::before": {
      content: { default: null, [regionOff]: "''", [regionOn]: "''" },
      position: {
        default: null,
        [regionOff]: "absolute",
        [regionOn]: "absolute",
      },
      inset: {
        default: null,
        [regionOff]: "-12px -12px -12px -40px",
        [regionOn]: "-12px -12px -12px -40px",
      },
      borderWidth: { default: null, [regionOff]: "1px", [regionOn]: "1px" },
      borderStyle: {
        default: null,
        [regionOff]: "solid",
        [regionOn]: "solid",
      },
      borderColor: {
        default: null,
        [regionOff]: tokens.transparent,
        [regionOn]: tokens.accent,
      },
      borderRadius: {
        default: null,
        [regionOff]: radius.surface,
        [regionOn]: radius.surface,
      },
      pointerEvents: {
        default: null,
        [regionOff]: "none",
        [regionOn]: "none",
      },
      transition: {
        default: null,
        [regionOff]: `border-color ${drawMotion.ring} ${motion.ease}`,
        [regionOn]: `border-color ${drawMotion.ring} ${motion.ease}`,
      },
      animationName: {
        default: null,
        [regionWriting]: {
          default: regionPulseBorder,
          [stylex.env.reducedMotion]: "none",
        },
      },
      animationDuration: {
        default: null,
        [regionWriting]: {
          default: motion.pulse,
          [stylex.env.reducedMotion]: motion.instant,
        },
      },
      animationTimingFunction: {
        default: null,
        [regionWriting]: {
          default: "ease-in-out",
          [stylex.env.reducedMotion]: "ease",
        },
      },
      animationIterationCount: {
        default: null,
        [regionWriting]: {
          default: "infinite",
          [stylex.env.reducedMotion]: "1",
        },
      },
    },
  },
  // Retitle: a section heading recomposes; its children stay.
  retitledHeading: {
    animationName: {
      default: null,
      [stylex.when.ancestor(
        ':is([data-motion="retitle"])',
        documentNodeMarker,
      )]: { default: label, [stylex.env.reducedMotion]: "none" },
    },
    animationDuration: {
      default: null,
      [stylex.when.ancestor(
        ':is([data-motion="retitle"])',
        documentNodeMarker,
      )]: {
        default: drawMotion.stroke,
        [stylex.env.reducedMotion]: motion.instant,
      },
    },
    animationTimingFunction: {
      default: null,
      [stylex.when.ancestor(
        ':is([data-motion="retitle"])',
        documentNodeMarker,
      )]: { default: "steps(14)", [stylex.env.reducedMotion]: "ease" },
    },
    animationFillMode: {
      default: null,
      [stylex.when.ancestor(
        ':is([data-motion="retitle"])',
        documentNodeMarker,
      )]: { default: "both", [stylex.env.reducedMotion]: "none" },
    },
  },
  // A callout's title, while its block is retitled.
  retitle: {
    animationName: { default: label, [stylex.env.reducedMotion]: "none" },
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
  // Diagram units wait unseen while queued.
  hidden: {
    opacity: 0,
  },
  // A unit's stroke, traced end to end with pathLength=1: one quick pass
  // over a diagram written whole, or the outline of a new unit.
  traceQuick: {
    strokeDasharray: "1",
    animationName: { default: trace, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.quick,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "linear",
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  traceNode: {
    strokeDasharray: "1",
    animationName: { default: trace, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.stroke,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: motion.enter,
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  traceLine: {
    strokeDasharray: "1",
    animationName: { default: trace, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.line,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: motion.enter,
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  // The marker wash and a pulse once a node is traced, or again when it is
  // relabeled.
  fill: {
    animationName: { default: nodeFill, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.fill,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "ease-out",
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  refill: {
    animationName: { default: nodeFill, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.stroke,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "ease-out",
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  // Labels compose left to right once their unit is drawn.
  labelQuick: {
    animationName: { default: label, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.label,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "steps(8)",
      [stylex.env.reducedMotion]: "ease",
    },
    animationDelay: {
      default: drawDelay.labelQuick,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  labelFill: {
    animationName: { default: label, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.fill,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "steps(12)",
      [stylex.env.reducedMotion]: "ease",
    },
    animationDelay: {
      default: drawDelay.labelFill,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  labelEdgeQuick: {
    animationName: { default: label, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.tick,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "steps(6)",
      [stylex.env.reducedMotion]: "ease",
    },
    animationDelay: {
      default: drawDelay.labelEdgeQuick,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  labelEdge: {
    animationName: { default: label, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.beat,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "steps(8)",
      [stylex.env.reducedMotion]: "ease",
    },
    animationDelay: {
      default: drawDelay.labelEdge,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  labelStep: {
    animationName: { default: label, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.label,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "steps(8)",
      [stylex.env.reducedMotion]: "ease",
    },
    animationDelay: {
      default: drawDelay.labelStep,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  // A lens row wipes in behind the slot, or is erased.
  rowLanding: {
    maskImage: { default: wipeMask, [stylex.env.reducedMotion]: "none" },
    animationName: { default: wipe, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.rowLand,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: motion.enter,
      [stylex.env.reducedMotion]: "ease",
    },
    animationDelay: {
      default: drawDelay.rowLand,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  rowErasing: {
    animationName: { default: erase, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.rowErase,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "linear",
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: {
      default: "forwards",
      [stylex.env.reducedMotion]: "none",
    },
    opacity: 0,
  },
  // A sequence step's dot pops once its line is drawn.
  stepPop: {
    animationName: { default: stepPop, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.line,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: motion.enter,
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
});
