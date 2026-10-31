import {
  fontSize,
  fontWeight,
  layer,
  radius,
  space,
} from "@canvas/scale.stylex";
import { Button, IconButton } from "@canvas/ui/button";
import { iconStyles } from "@canvas/ui/icon-styles";
import { CheckIcon, CloseIcon } from "@canvas/ui/icons";
import { pillStyles } from "@canvas/ui/pill";
import { surfaceStyles } from "@canvas/ui/surface";
import { useTooltip } from "@canvas/ui/tooltip";
import type {
  ReviewCanvasPendingUpdate,
  ReviewCanvasUpdateHost,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useState, useSyncExternalStore } from "react";

import { tickerMotion } from "./ticker-motion.stylex";
import { tokens } from "./tokens.stylex";

/** Stays while an update waits, after its toast is gone. */
export function UpdateChip({ host }: { host: ReviewCanvasUpdateHost }) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const subscription = host.onDidChange(listener);

      return () => subscription.dispose();
    },
    [host],
  );

  const update = useSyncExternalStore(subscribe, host.current);
  const [dismissed, setDismissed] = useState<ReviewCanvasPendingUpdate>();
  const tooltip = useTooltip("Dismiss");

  if (!update || update === dismissed) return null;
  const restart = update.action === "restart";
  const named = update.version ? `Whiteboard ${update.version}` : "Update";

  const message = restart
    ? `${named} installed. Open whiteboards won't be lost.`
    : `${named} is available. Update with your system package manager.`;

  return (
    <div
      role="status"
      {...stylex.props(surfaceStyles.popover, pillStyles.pill, styles.pill)}
    >
      <span {...stylex.props(styles.check)}>
        <CheckIcon xstyle={[iconStyles.inline, styles.checkIcon]} />
      </span>
      <span {...stylex.props(styles.ticker)}>
        <span {...stylex.props(styles.track)}>
          <span {...stylex.props(styles.message)}>{message}</span>
          <span aria-hidden {...stylex.props(styles.message, styles.echo)}>
            {message}
          </span>
        </span>
      </span>
      <Button
        variant="ghost"
        xstyle={styles.relaunch}
        onClick={() => host.apply()}
      >
        {restart ? "Relaunch Now" : "Instructions"}
      </Button>
      <IconButton
        ref={tooltip}
        aria-label="Dismiss"
        xstyle={styles.close}
        onClick={() => setDismissed(update)}
      >
        <CloseIcon xstyle={iconStyles.inert} />
      </IconButton>
    </div>
  );
}

const scroll = stylex.keyframes({
  from: { transform: "translateX(0)" },
  to: { transform: "translateX(-50%)" },
});

const styles = stylex.create({
  pill: {
    position: "fixed",
    zIndex: layer.overlay,
    left: space.s16,
    bottom: space.s16,
    padding: space.s6,
    paddingLeft: space.s10,
    maxWidth: `calc(100vw - ${space.s32})`,
  },
  check: {
    display: "flex",
    flex: "none",
    alignItems: "center",
    justifyContent: "center",
    width: space.s20,
    height: space.s20,
    borderRadius: radius.pill,
    backgroundColor: tokens.changeAdded,
  },
  checkIcon: {
    color: tokens.bg,
  },
  ticker: {
    overflow: "hidden",
    flex: "0 1 auto",
    minWidth: 0,
    width: {
      default: space.s160,
      [stylex.env.narrow]: space.s96,
      [stylex.env.reducedMotion]: "auto",
    },
    maskImage: {
      default: `linear-gradient(90deg, ${tokens.transparent}, ${tokens.ink} ${space.s12}, ${tokens.ink} calc(100% - ${space.s12}), ${tokens.transparent})`,
      [stylex.env.reducedMotion]: "none",
    },
  },
  track: {
    display: "flex",
    width: { default: "max-content", [stylex.env.reducedMotion]: "auto" },
    animationName: { default: scroll, [stylex.env.reducedMotion]: "none" },
    animationDuration: tickerMotion.loop,
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    animationPlayState: { default: "running", ":hover": "paused" },
  },
  message: {
    paddingRight: { default: space.s32, [stylex.env.reducedMotion]: 0 },
    color: tokens.changeAdded,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    whiteSpace: "nowrap",
    overflow: { default: null, [stylex.env.reducedMotion]: "hidden" },
    textOverflow: { default: null, [stylex.env.reducedMotion]: "ellipsis" },
  },
  // Closes the scrolling loop.
  echo: {
    display: { default: null, [stylex.env.reducedMotion]: "none" },
  },
  relaunch: {
    borderRadius: radius.pill,
    backgroundColor: {
      default: `color-mix(in srgb, ${tokens.changeAdded} 16%, ${tokens.transparent})`,
      ":hover": `color-mix(in srgb, ${tokens.changeAdded} 24%, ${tokens.transparent})`,
    },
    color: tokens.changeAdded,
  },
  close: {
    borderRadius: radius.pill,
  },
});
