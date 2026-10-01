import { drawMotion } from "@canvas/draw-motion.stylex";
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

const REDUCED = "@media (prefers-reduced-motion: reduce)";

const ease = "cubic-bezier(0.2, 0.7, 0.2, 1)";

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
  [landingChild]: { default: wipe, [REDUCED]: "none" },
  [rewritingChild]: { default: `${erase}, ${rewrite}`, [REDUCED]: "none" },
  [erasingChild]: { default: erase, [REDUCED]: "none" },
};

const childAnimationDuration = {
  [landingChild]: { default: "420ms", [REDUCED]: "0s" },
  [rewritingChild]: { default: "400ms, 500ms", [REDUCED]: "0s" },
  [erasingChild]: { default: "400ms", [REDUCED]: "0s" },
};

const childAnimationTimingFunction = {
  [landingChild]: { default: ease, [REDUCED]: "ease" },
  [rewritingChild]: { default: `linear, ${ease}`, [REDUCED]: "ease" },
  [erasingChild]: { default: "linear", [REDUCED]: "ease" },
};

const childAnimationDelay = {
  [landingChild]: { default: "260ms", [REDUCED]: "0s" },
  [rewritingChild]: { default: "200ms, 600ms", [REDUCED]: "0s" },
  [erasingChild]: { default: "0s", [REDUCED]: "0s" },
};

const childAnimationFillMode = {
  [landingChild]: { default: "both", [REDUCED]: "none" },
  [rewritingChild]: { default: "both, both", [REDUCED]: "none" },
  [erasingChild]: { default: "forwards", [REDUCED]: "none" },
};

const childAnimationList = {
  [rewritingChild]: { default: "1, 1", [REDUCED]: "1" },
};

const childAnimationDirection = {
  [rewritingChild]: { default: "normal, normal", [REDUCED]: "normal" },
};

const childAnimationPlayState = {
  [rewritingChild]: { default: "running, running", [REDUCED]: "running" },
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
  display: { default: null, [REDUCED]: "none" },
  animationName: {
    default: `${eraserIn}, ${eraserSweeps}, ${eraserOut}`,
    [REDUCED]: "none",
  },
  animationIterationCount: { default: "1, 1, 1", [REDUCED]: "1" },
  animationDirection: {
    default: "normal, normal, normal",
    [REDUCED]: "normal",
  },
  animationPlayState: {
    default: "running, running, running",
    [REDUCED]: "running",
  },
  animationFillMode: { default: "both, both, both", [REDUCED]: "none" },
  animationTimingFunction: {
    default: `${ease}, linear, ease`,
    [REDUCED]: "ease",
  },
};

export const drawStyles = stylex.create({
  // Every element a block renders as its own: the content wipes in behind
  // the dot, is erased and rewritten, or is erased for good. Opt-in: a new
  // block type must apply it to its root element or it skips these phases.
  blockChild: {
    WebkitMaskImage: {
      default: null,
      [landingChild]: { default: wipeMask, [REDUCED]: "none" },
    },
    maskImage: {
      default: null,
      [landingChild]: { default: wipeMask, [REDUCED]: "none" },
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
      display: { default: null, [REDUCED]: "none" },
      animationName: { default: `${wipe}, ${dotFade}`, [REDUCED]: "none" },
      animationDuration: {
        default: `${drawMotion.stroke}, ${drawMotion.dotFade}`,
        [REDUCED]: motion.instant,
      },
      animationTimingFunction: { default: `${ease}, ease`, [REDUCED]: "ease" },
      animationDelay: { default: "260ms, 680ms", [REDUCED]: "0s" },
      animationFillMode: { default: "both, both", [REDUCED]: "none" },
      animationIterationCount: { default: "1, 1", [REDUCED]: "1" },
      animationDirection: { default: "normal, normal", [REDUCED]: "normal" },
      animationPlayState: {
        default: "running, running",
        [REDUCED]: "running",
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
        [REDUCED]: motion.instant,
      },
      animationDelay: { default: "0s, 200ms, 600ms", [REDUCED]: "0s" },
    },
  },
  // Erasing: the eraser's three passes, then the board closes over the gap.
  erasing: {
    position: "relative",
    display: { default: null, [REDUCED]: "none" },
    overflow: "clip",
    interpolateSize: "allow-keywords",
    "::before": {
      ...eraser,
      animationDuration: {
        default: `${drawMotion.tick}, ${drawMotion.pass}, ${drawMotion.tick}`,
        [REDUCED]: motion.instant,
      },
      animationDelay: { default: "0s, 0s, 400ms", [REDUCED]: "0s" },
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
  // A block's own animation; a block is also the child of a tutorial
  // feature, whose phase then draws it.
  blockLand: {
    animationName: {
      default: landSlot,
      [ringOnSection]: "none",
      [REDUCED]: "none",
      ...childAnimationName,
    },
    animationDuration: {
      default: drawMotion.land,
      [ringOnSection]: motion.instant,
      [REDUCED]: motion.instant,
      ...childAnimationDuration,
    },
    animationTimingFunction: {
      default: ease,
      [ringOnSection]: "ease",
      [REDUCED]: "ease",
      ...childAnimationTimingFunction,
    },
    animationDelay: { default: null, ...childAnimationDelay },
    animationFillMode: {
      default: "both",
      [ringOnSection]: "none",
      [REDUCED]: "none",
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
      [REDUCED]: "none",
      ...childAnimationName,
    },
    animationDuration: {
      default: drawMotion.collapse,
      [ringOnSection]: motion.instant,
      [REDUCED]: motion.instant,
      ...childAnimationDuration,
    },
    animationTimingFunction: {
      default: ease,
      [ringOnSection]: "ease",
      [REDUCED]: "ease",
      ...childAnimationTimingFunction,
    },
    animationDelay: {
      default: "400ms",
      [ringOnSection]: "0s",
      [REDUCED]: "0s",
      ...childAnimationDelay,
    },
    animationFillMode: {
      default: "both",
      [ringOnSection]: "none",
      [REDUCED]: "none",
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
      [REDUCED]: "none",
      ...childAnimationName,
    },
    animationDuration: {
      default: motion.pulse,
      [ringOnSection]: motion.instant,
      [REDUCED]: motion.instant,
      ...childAnimationDuration,
    },
    animationTimingFunction: {
      default: "ease-in-out",
      [ringOnSection]: "ease",
      [REDUCED]: "ease",
      ...childAnimationTimingFunction,
    },
    animationDelay: { default: null, ...childAnimationDelay },
    animationFillMode: { default: null, ...childAnimationFillMode },
    animationIterationCount: {
      default: "infinite",
      [ringOnSection]: "1",
      [REDUCED]: "1",
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
        [regionWriting]: { default: regionPulseBorder, [REDUCED]: "none" },
      },
      animationDuration: {
        default: null,
        [regionWriting]: { default: motion.pulse, [REDUCED]: motion.instant },
      },
      animationTimingFunction: {
        default: null,
        [regionWriting]: { default: "ease-in-out", [REDUCED]: "ease" },
      },
      animationIterationCount: {
        default: null,
        [regionWriting]: { default: "infinite", [REDUCED]: "1" },
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
      )]: { default: label, [REDUCED]: "none" },
    },
    animationDuration: {
      default: null,
      [stylex.when.ancestor(
        ':is([data-motion="retitle"])',
        documentNodeMarker,
      )]: { default: drawMotion.stroke, [REDUCED]: motion.instant },
    },
    animationTimingFunction: {
      default: null,
      [stylex.when.ancestor(
        ':is([data-motion="retitle"])',
        documentNodeMarker,
      )]: { default: "steps(14)", [REDUCED]: "ease" },
    },
    animationFillMode: {
      default: null,
      [stylex.when.ancestor(
        ':is([data-motion="retitle"])',
        documentNodeMarker,
      )]: { default: "both", [REDUCED]: "none" },
    },
  },
  // A callout's title, while its block is retitled.
  retitle: {
    animationName: { default: label, [REDUCED]: "none" },
    animationDuration: {
      default: drawMotion.stroke,
      [REDUCED]: motion.instant,
    },
    animationTimingFunction: { default: "steps(14)", [REDUCED]: "ease" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  // Diagram units wait unseen while queued.
  hidden: {
    opacity: 0,
  },
  // A unit's stroke, traced end to end with pathLength=1: one quick pass
  // over a diagram written whole, or the outline of a new unit.
  traceQuick: {
    strokeDasharray: "1",
    animationName: { default: trace, [REDUCED]: "none" },
    animationDuration: { default: drawMotion.quick, [REDUCED]: motion.instant },
    animationTimingFunction: { default: "linear", [REDUCED]: "ease" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  traceNode: {
    strokeDasharray: "1",
    animationName: { default: trace, [REDUCED]: "none" },
    animationDuration: {
      default: drawMotion.stroke,
      [REDUCED]: motion.instant,
    },
    animationTimingFunction: { default: ease, [REDUCED]: "ease" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  traceLine: {
    strokeDasharray: "1",
    animationName: { default: trace, [REDUCED]: "none" },
    animationDuration: { default: drawMotion.line, [REDUCED]: motion.instant },
    animationTimingFunction: { default: ease, [REDUCED]: "ease" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  // The marker wash and a pulse once a node is traced, or again when it is
  // relabeled.
  fill: {
    animationName: { default: nodeFill, [REDUCED]: "none" },
    animationDuration: { default: drawMotion.fill, [REDUCED]: motion.instant },
    animationTimingFunction: { default: "ease-out", [REDUCED]: "ease" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  refill: {
    animationName: { default: nodeFill, [REDUCED]: "none" },
    animationDuration: {
      default: drawMotion.stroke,
      [REDUCED]: motion.instant,
    },
    animationTimingFunction: { default: "ease-out", [REDUCED]: "ease" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  // Labels compose left to right once their unit is drawn.
  labelQuick: {
    animationName: { default: label, [REDUCED]: "none" },
    animationDuration: { default: drawMotion.label, [REDUCED]: motion.instant },
    animationTimingFunction: { default: "steps(8)", [REDUCED]: "ease" },
    animationDelay: { default: "60ms", [REDUCED]: "0s" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  labelFill: {
    animationName: { default: label, [REDUCED]: "none" },
    animationDuration: { default: drawMotion.fill, [REDUCED]: motion.instant },
    animationTimingFunction: { default: "steps(12)", [REDUCED]: "ease" },
    animationDelay: { default: "90ms", [REDUCED]: "0s" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  labelEdgeQuick: {
    animationName: { default: label, [REDUCED]: "none" },
    animationDuration: { default: drawMotion.tick, [REDUCED]: motion.instant },
    animationTimingFunction: { default: "steps(6)", [REDUCED]: "ease" },
    animationDelay: { default: "100ms", [REDUCED]: "0s" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  labelEdge: {
    animationName: { default: label, [REDUCED]: "none" },
    animationDuration: { default: drawMotion.beat, [REDUCED]: motion.instant },
    animationTimingFunction: { default: "steps(8)", [REDUCED]: "ease" },
    animationDelay: { default: "300ms", [REDUCED]: "0s" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  labelStep: {
    animationName: { default: label, [REDUCED]: "none" },
    animationDuration: { default: drawMotion.label, [REDUCED]: motion.instant },
    animationTimingFunction: { default: "steps(8)", [REDUCED]: "ease" },
    animationDelay: { default: "120ms", [REDUCED]: "0s" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  // A lens row wipes in behind the slot, or is erased.
  rowLanding: {
    maskImage: { default: wipeMask, [REDUCED]: "none" },
    animationName: { default: wipe, [REDUCED]: "none" },
    animationDuration: {
      default: drawMotion.rowLand,
      [REDUCED]: motion.instant,
    },
    animationTimingFunction: { default: ease, [REDUCED]: "ease" },
    animationDelay: { default: "180ms", [REDUCED]: "0s" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  rowErasing: {
    animationName: { default: erase, [REDUCED]: "none" },
    animationDuration: {
      default: drawMotion.rowErase,
      [REDUCED]: motion.instant,
    },
    animationTimingFunction: { default: "linear", [REDUCED]: "ease" },
    animationFillMode: { default: "forwards", [REDUCED]: "none" },
    opacity: 0,
  },
  // A sequence step's dot pops once its line is drawn.
  stepPop: {
    animationName: { default: stepPop, [REDUCED]: "none" },
    animationDuration: { default: drawMotion.line, [REDUCED]: motion.instant },
    animationTimingFunction: { default: ease, [REDUCED]: "ease" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
});
