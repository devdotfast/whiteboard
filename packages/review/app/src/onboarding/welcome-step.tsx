import {
  elevation,
  fontSize,
  fontWeight,
  motion,
  radius,
  tracking,
} from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { Button } from "@canvas/ui/button";
import { Kbd } from "@canvas/ui/kbd";
import { textStyles } from "@canvas/ui/text";
import * as stylex from "@stylexjs/stylex";

import { ScreenCopy, useReturnKey } from "./onboarding-parts";
import { onboardingStyles } from "./onboarding-styles";
import { onboardingMotion } from "./onboarding.stylex";

/** First screen: what Whiteboard is, and one button. */
export function WelcomeStep({ onStart }: { onStart(): void }) {
  useReturnKey(true, onStart);

  return (
    <div {...stylex.props(onboardingStyles.stage, styles.stage)}>
      <ScreenCopy
        eyebrow="Welcome to Whiteboard"
        heading="Your codebase, explained by your agent."
        hero
      >
        <Button
          variant="primary"
          size="large"
          xstyle={onboardingStyles.primary}
          onClick={onStart}
          autoFocus
        >
          Get started
          <Kbd xstyle={onboardingStyles.primaryKey}>↵</Kbd>
        </Button>
      </ScreenCopy>
      <BoardSketch />
    </div>
  );
}

/** Two board cards dropped on the grid, drawn in once. */
function BoardSketch() {
  return (
    <div
      aria-hidden="true"
      {...stylex.props(onboardingStyles.panel, styles.board)}
    >
      <div {...stylex.props(styles.card, styles.summary)}>
        <span {...stylex.props(styles.meta)}>acme/payments · PR #412</span>
        <span {...stylex.props(styles.cardTitle)}>
          Retry failed webhooks with backoff
        </span>
        <svg {...stylex.props(styles.underline)} viewBox="0 0 210 6">
          <path
            {...stylex.props(styles.stroke, styles.underlineStroke)}
            d="M1 3.5C50 1.5 120 4.5 209 2"
            pathLength={1}
          />
        </svg>
        <span {...stylex.props(styles.cardBody)}>
          Failed deliveries now go to a queue and retry at 1, 4 and 16 minutes
          before the endpoint is marked unhealthy.
        </span>
      </div>
      <div {...stylex.props(styles.card, styles.flow)}>
        <span {...stylex.props(textStyles.eyebrow, styles.mono)}>
          Delivery flow
        </span>
        <div {...stylex.props(styles.flowRow)}>
          <span {...stylex.props(styles.node)}>dispatch()</span>
          <FlowArrow />
          <span {...stylex.props(styles.node, styles.nodeActive)}>
            RetryQueue
          </span>
          <FlowArrow xstyle={styles.wideOnly} />
          <span {...stylex.props(styles.node, styles.wideOnly)}>endpoint</span>
        </div>
        <div {...stylex.props(styles.counts)}>
          <span {...stylex.props(styles.added)}>+148</span>
          <span {...stylex.props(styles.removed)}>−36</span>
          <span {...stylex.props(styles.meta)}>· 7 files</span>
        </div>
      </div>
    </div>
  );
}

function FlowArrow({ xstyle }: { xstyle?: stylex.StyleXStyles }) {
  return (
    <svg {...stylex.props(styles.arrow, xstyle)} viewBox="0 0 44 14">
      <path
        {...stylex.props(styles.stroke, styles.arrowStroke)}
        d="M2 7.5C14 6 28 8 38 7M33 3l6 4-6 4"
        pathLength={1}
      />
    </svg>
  );
}

// The board is as wide as the window leaves it; its flow drops its last
// step when the three no longer fit.
const narrowBoard = "@container (max-width: 520px)";

const drop = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-16px) rotate(var(--tilt-from))" },
  to: { opacity: 1, transform: "rotate(var(--tilt))" },
});

const draw = stylex.keyframes({
  from: { strokeDashoffset: 1 },
  to: { strokeDashoffset: 0 },
});

const styles = stylex.create({
  // A full-screen window keeps the copy and the board together in the middle,
  // rather than spreading them to its edges.
  stage: {
    alignSelf: "center",
    width: "100%",
    maxWidth: "1400px",
    boxSizing: "border-box",
  },
  board: {
    position: "relative",
    alignSelf: { default: "center", "@media (max-width: 1100px)": "stretch" },
    height: "min(640px, 100%)",
    minHeight: "520px",
    overflow: "hidden",
    containerType: "inline-size",
    backgroundImage: `radial-gradient(circle, ${tokens.canvasGrid} 1px, ${tokens.transparent} 1.2px)`,
    backgroundSize: "24px 24px",
  },
  card: {
    position: "absolute",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.surface,
    borderRadius: radius.surface,
    boxShadow: elevation.popover,
    transform: "rotate(var(--tilt))",
    animationName: { default: drop, [stylex.env.reducedMotion]: "none" },
    animationDuration: onboardingMotion.screen,
    animationTimingFunction: motion.enter,
    animationFillMode: "both",
  },
  summary: {
    "--tilt": "-1.5deg",
    "--tilt-from": "-4deg",
    top: "48px",
    left: "40px",
    right: "24px",
    maxWidth: "400px",
    gap: "12px",
    padding: "24px 28px 28px",
    animationDelay: onboardingMotion.summaryCard,
  },
  flow: {
    "--tilt": "1.2deg",
    "--tilt-from": "4deg",
    bottom: "48px",
    left: "24px",
    right: "40px",
    maxWidth: "460px",
    marginInlineStart: { default: "96px", [narrowBoard]: "0" },
    gap: "18px",
    padding: "22px 24px 26px",
    animationDelay: onboardingMotion.flowCard,
  },
  meta: {
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  mono: { fontFamily: tokens.fontMono },
  cardTitle: {
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.display,
    fontWeight: fontWeight.medium,
    letterSpacing: tracking.tight,
    lineHeight: "28px",
  },
  cardBody: {
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    fontSize: fontSize.reading,
    lineHeight: "24px",
  },
  underline: { width: "210px", height: "6px", overflow: "visible" },
  stroke: {
    fill: "none",
    stroke: tokens.accent,
    strokeDasharray: 1,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    animationName: { default: draw, [stylex.env.reducedMotion]: "none" },
    animationDuration: onboardingMotion.screen,
    animationTimingFunction: "ease-out",
    animationFillMode: "both",
  },
  underlineStroke: {
    strokeWidth: 2.4,
    animationDelay: onboardingMotion.underline,
  },
  arrowStroke: { strokeWidth: 1.8, animationDelay: onboardingMotion.arrow },
  flowRow: { display: "flex", alignItems: "center" },
  node: {
    paddingBlock: "10px",
    paddingInline: "14px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.control,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    whiteSpace: "nowrap",
  },
  nodeActive: {
    borderColor: tokens.accent,
    color: tokens.accent,
    backgroundColor: tokens.accentSoft,
    fontWeight: fontWeight.medium,
  },
  arrow: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: "44px",
    minWidth: "16px",
    height: "14px",
  },
  wideOnly: { display: { default: null, [narrowBoard]: "none" } },
  counts: {
    display: "flex",
    gap: "12px",
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  added: { color: tokens.changeAdded },
  removed: { color: tokens.changeRemoved },
});
