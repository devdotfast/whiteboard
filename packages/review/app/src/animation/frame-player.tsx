// An animation's frames: the reader steps through them, or plays them, each
// held for its duration and until the stage says its motion settled.

import type { BlockProps } from "@canvas/blocks";
import { radius, space } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { useTooltip } from "@canvas/ui/tooltip";
import * as stylex from "@stylexjs/stylex";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ControlButton,
  StopCaption,
  pauseIcon,
  playIcon,
  timerState,
  timerVars,
} from "./stage-controls";
import type { FrameTimer, StagePlayer, StageSend } from "./stage-player";
import type { StageMessage } from "./stage-protocol";

const DEFAULT_DURATION = 3000;

const sameKeys = (left: readonly string[], right: readonly string[] | null) =>
  right?.length === left.length && left.every((key, i) => key === right[i]);

export function useFramePlayer(
  node: BlockProps<"animation">["node"],
  send: StageSend,
): StagePlayer {
  const frames = node.frames;
  const [index, setIndex] = useState(0);
  const [sequenceKeys, setSequenceKeys] = useState<string[] | null>(null);
  const sequenceRef = useRef<string[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [settled, setSettled] = useState(-1);
  const [timeUp, setTimeUp] = useState(-1);
  // The frame's clock, as the strip and the dots draw it, and how far a
  // pause left it so play resumes from there.
  const [timer, setTimer] = useState<FrameTimer | null>(null);
  const heldRef = useRef({ index: -1, fraction: 0 });
  const indexRef = useRef(index);
  indexRef.current = index;

  const activeFrames = useMemo(() => {
    if (!sequenceKeys) return frames;
    const byKey = new Map(frames.map((item) => [item.key, item]));

    return sequenceKeys.flatMap((key) => {
      const item = byKey.get(key);

      return item ? [item] : [];
    });
  }, [frames, sequenceKeys]);

  const last = activeFrames.length - 1;
  const frame = frames[Math.min(index, frames.length - 1)]!;

  const activeIndex = Math.max(
    0,
    activeFrames.findIndex((item) => item.key === frame.key),
  );

  const go = useCallback(
    (target: number, instant: boolean) => {
      const keys = sequenceRef.current;

      const path = keys
        ? keys.flatMap((key) => {
            const item = frames.find((candidate) => candidate.key === key);

            return item ? [item] : [];
          })
        : frames;

      const currentKey = frames[indexRef.current]?.key;
      const currentPosition = path.findIndex((item) => item.key === currentKey);
      const position = Math.max(0, Math.min(path.length - 1, target));
      const next = frames.findIndex((item) => item.key === path[position]?.key);

      if (next < 0 || next === indexRef.current) return;
      setIndex(next);
      send({
        type: "frame",
        index: next,
        instant,
        direction:
          currentPosition < 0 || position === currentPosition
            ? "none"
            : position > currentPosition
              ? "forward"
              : "backward",
        adjacent: currentPosition >= 0 && position === currentPosition + 1,
      });
    },
    [frames, send],
  );

  // A stage script's setSequence() and the scenario picker both land here.
  const selectSequence = (keys: string[]) => {
    const unique = new Set(keys);

    const valid =
      unique.size === keys.length &&
      keys.every((key) => frames.some((frame) => frame.key === key));

    if (!valid) return;

    if (
      sequenceRef.current?.length === keys.length &&
      sequenceRef.current.every((key, index) => key === keys[index])
    )
      return;

    sequenceRef.current = keys;
    setSequenceKeys(keys);
    setPlaying(false);
    setTimeUp(-1);
    const currentKey = frames[indexRef.current]?.key;

    const fallback = frames.findIndex((frame) => frame.key === keys[0]);

    const next = keys.includes(currentKey) ? indexRef.current : fallback;

    if (next !== indexRef.current) setIndex(next);

    // Refresh even a preserved key: lifecycle ranges, held scene changes,
    // and its timeline can differ when active order changes.
    send({
      type: "frame",
      index: next,
      instant: true,
      direction: "none",
      adjacent: false,
    });
  };

  const receive = (message: StageMessage) => {
    switch (message.type) {
      case "settled":
        setSettled(message.index);
        break;
      case "goto": {
        const keys = sequenceRef.current;
        const path = keys ?? frames.map((item) => item.key);
        go(path.indexOf(message.key), true);
        break;
      }

      case "step": {
        const keys = sequenceRef.current;
        const path = keys ?? frames.map((item) => item.key);
        const currentKey = frames[indexRef.current]?.key;
        go(path.indexOf(currentKey) + message.delta, false);
        break;
      }

      case "sequence":
        selectSequence(message.keys);
        break;
    }
  };

  // A new stage starts in the scenario the reader had picked, or the first.
  const boot = () => {
    const sequence =
      (
        node.scenarios?.find((scenario) =>
          sameKeys(scenario.frames, sequenceRef.current),
        ) ?? node.scenarios?.[0]
      )?.frames ?? null;

    sequenceRef.current = sequence;
    setSequenceKeys(sequence);

    if (sequence && !sequence.includes(frames[indexRef.current]!.key)) {
      indexRef.current = frames.findIndex((item) => item.key === sequence[0]);
      setIndex(indexRef.current);
    }

    return {
      mode: "frames" as const,
      frames: frames.map(({ key, title, caption, data, code }) => ({
        key,
        title,
        caption,
        data,
        code,
      })),
      markers: [],
      scenarios: [],
      frame: indexRef.current,
      ...(sequence && { sequence }),
    };
  };

  // Play: hold each active-sequence frame for its duration and until its
  // motion ends. The clock runs from where a pause left this frame, and the
  // cleanup notes how far it got.
  useEffect(() => {
    if (!playing) return;

    const duration = frame.duration ?? DEFAULT_DURATION;
    const held = heldRef.current;
    const from = held.index === index ? held.fraction : 0;
    const remaining = Math.round((1 - from) * duration);
    const began = performance.now();
    setTimer({ fraction: from, remaining, running: true });
    const timeout = setTimeout(() => setTimeUp(index), remaining);

    return () => {
      clearTimeout(timeout);

      const ran = Math.min(
        1,
        (performance.now() - began) / Math.max(1, remaining),
      );

      heldRef.current = { index, fraction: from + (1 - from) * ran };
    };
  }, [playing, index, frame.duration]);

  // Paused: the marker holds where it was. A frame reached by hand has no
  // clock, and forgets the one it held.
  useEffect(() => {
    if (playing) return;

    const held = heldRef.current;

    if (held.index === index)
      setTimer({ fraction: held.fraction, remaining: 0, running: false });
    else {
      heldRef.current = { index: -1, fraction: 0 };
      setTimer(null);
    }
  }, [playing, index]);

  useEffect(() => {
    if (!playing || timeUp !== index || settled !== index) return;

    if (activeIndex >= last) setPlaying(false);
    else go(activeIndex + 1, false);
  }, [playing, timeUp, settled, index, activeIndex, last, go]);

  // An edit can drop frames or a sequence selection from under the current one.
  useEffect(() => {
    if (!activeFrames.some((item) => item.key === frame.key)) go(0, true);
  }, [activeFrames, frame.key, go]);

  const pick = (position: number) =>
    go(position, Math.abs(position - activeIndex) > 1);

  const steps = activeFrames.every((item) => item.label) ? activeFrames : null;

  return {
    stops: activeFrames,
    activeIndex,
    pick,
    boot,
    receive,
    scenario: node.scenarios?.find((scenario) =>
      sameKeys(scenario.frames, sequenceKeys),
    )?.key,
    selectScenario(key) {
      const keys = node.scenarios?.find(
        (scenario) => scenario.key === key,
      )?.frames;

      if (!keys) return;
      send({ type: "sequence", keys });
      selectSequence(keys);
    },
    strip: steps && {
      label: "Steps",
      items: steps.map((item) => ({ key: item.key, text: item.label! })),
      timer,
    },
    onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") go(activeIndex + 1, false);
      else if (event.key === "ArrowLeft") go(activeIndex - 1, false);
      else return;

      event.preventDefault();
    },
    controls: (
      <>
        <ControlButton
          label="Previous frame"
          disabled={activeIndex === 0}
          onClick={() => go(activeIndex - 1, false)}
        >
          <path d="M14.5 6.5 9 12l5.5 5.5" />
        </ControlButton>
        <ControlButton
          label={playing ? "Pause" : activeIndex >= last ? "Replay" : "Play"}
          onClick={() => {
            if (playing) return setPlaying(false);

            // Replay starts the first frame's clock over.
            if (activeIndex >= last) {
              heldRef.current = { index: -1, fraction: 0 };
              go(0, true);
            }

            setPlaying(true);
          }}
        >
          {playing ? pauseIcon : playIcon}
        </ControlButton>
        <ControlButton
          label="Next frame"
          disabled={activeIndex >= last}
          onClick={() => go(activeIndex + 1, false)}
        >
          <path d="M9.5 6.5 15 12l-5.5 5.5" />
        </ControlButton>
        <StopCaption stops={activeFrames} activeIndex={activeIndex} />
        {!steps && (
          <div {...stylex.props(styles.dots)} role="group" aria-label="Frames">
            {activeFrames.map((item, position) => (
              <FrameDot
                key={item.key}
                title={item.title}
                current={position === activeIndex}
                timer={position === activeIndex ? timer : null}
                onClick={() => pick(position)}
              />
            ))}
          </div>
        )}
      </>
    ),
  };
}

/** One frame of a strip without labels. The current dot carries the clock
 * while playing: a ring swept clockwise over a wash, whole when time is up.
 * At rest, and while paused, it is the filled dot it always was. */
function FrameDot({
  title,
  current,
  timer,
  onClick,
}: {
  title: string;
  current: boolean;
  timer: FrameTimer | null;
  onClick(): void;
}) {
  const tooltip = useTooltip(title, { instant: true });
  const sweeping = timer?.running === true;

  return (
    <button
      ref={tooltip}
      type="button"
      aria-label={title}
      aria-current={current ? "step" : undefined}
      data-frame-timer={timer ? timerState(timer) : undefined}
      onClick={onClick}
      {...stylex.props(
        styles.dot,
        current && styles.dotCurrent,
        sweeping && styles.dotSweeping,
      )}
      style={sweeping ? timerVars(timer) : undefined}
    >
      {sweeping && (
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 8 8"
          {...stylex.props(styles.sweep)}
        >
          <circle
            cx="4"
            cy="4"
            r="3.5"
            pathLength={1}
            {...stylex.props(styles.sweepRing)}
          />
        </svg>
      )}
    </button>
  );
}

// The ring drawn clockwise from twelve as the frame's time runs.
const sweep = stylex.keyframes({
  to: { strokeDashoffset: 0 },
});

const styles = stylex.create({
  dots: {
    display: "flex",
    flex: "0 0 auto",
    gap: space.s6,
  },
  dot: {
    position: "relative",
    width: "8px",
    height: "8px",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.inkFaint,
    borderRadius: radius.round,
    backgroundColor: tokens.transparent,
    cursor: "pointer",
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: "2px",
  },
  dotCurrent: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accent,
  },
  // While the clock runs, the dot is a wash ring the marker sweeps around.
  dotSweeping: {
    borderColor: {
      default: tokens.accentStripe,
      [stylex.env.reducedMotion]: tokens.accent,
    },
    backgroundColor: {
      default: tokens.transparent,
      [stylex.env.reducedMotion]: tokens.accent,
    },
  },
  sweep: {
    position: "absolute",
    inset: "-1px",
    display: { default: "block", [stylex.env.reducedMotion]: "none" },
    width: "8px",
    height: "8px",
    overflow: "visible",
    transform: "rotate(-90deg)",
  },
  sweepRing: {
    fill: "none",
    stroke: tokens.accent,
    strokeWidth: 1.4,
    strokeDasharray: 1,
    strokeDashoffset: tokens.frameTimerRest,
    animationName: sweep,
    animationDuration: tokens.frameTimerMs,
    animationTimingFunction: "linear",
    animationFillMode: "forwards",
  },
});
