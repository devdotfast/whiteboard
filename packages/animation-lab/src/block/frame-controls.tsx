import type { KeyboardEvent } from "react";

import type { Frame } from "./model";

/**
 * The step rail under the stage: every frame is a named step the reader
 * can jump to, with the current frame's caption and back and forward
 * below. Forward on the last frame replays from the start. Left and Right
 * step from anywhere in the controls; Home and End jump to the ends. In a
 * narrow block the rail keeps its dots and the current step's name moves
 * above the caption.
 */
export function FrameControls({
  frames,
  index,
  onStep,
  onShowCode,
  onReplayStep,
  width,
}: {
  frames: Frame[];
  index: number;
  onStep(index: number): void;
  /** Shows the current step's code beside the stage; absent when the step
   * links none. */
  onShowCode?(): void;
  /** Plays the current step's motion again; absent when it has none. */
  onReplayStep?(): void;
  /** The stage's width; the controls line up with it. */
  width: number;
}) {
  const last = frames.length - 1;
  const frame = frames[index];

  const name = (item: Frame | undefined, position: number) =>
    item?.label ?? `Step ${position + 1}`;

  const onKeyDown = (event: KeyboardEvent) => {
    const next = {
      ArrowLeft: Math.max(index - 1, 0),
      ArrowRight: Math.min(index + 1, last),
      Home: 0,
      End: last,
    }[event.key];

    if (next === undefined) return;
    event.preventDefault();
    onStep(next);
  };

  return (
    // Arrow keys from any button in the controls step the frames.
    <div className="frames" style={{ maxWidth: width }} onKeyDown={onKeyDown}>
      <ol className="rail" aria-label="Steps">
        {frames.map((item, position) => (
          <li
            key={item.id}
            className="rail-step"
            data-state={
              position < index
                ? "done"
                : position === index
                  ? "current"
                  : "next"
            }
          >
            <button
              type="button"
              className="rail-button"
              aria-label={`Step ${position + 1} of ${frames.length}: ${name(item, position)}`}
              aria-current={position === index ? "step" : undefined}
              title={item.caption}
              onClick={() => onStep(position)}
            >
              <span className="rail-track" aria-hidden="true">
                <span className="rail-dot" />
              </span>
              <span className="rail-label">{name(item, position)}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="frame-caption-row">
        <p className="frame-caption" aria-live="polite">
          <span className="frame-name">{name(frame, index)}</span>
          {frame?.caption}
        </p>
        <div className="frame-arrows">
          {onReplayStep && (
            <button
              type="button"
              className="frame-arrow"
              aria-label="Replay step"
              title="Replay this step"
              onClick={onReplayStep}
            >
              <ReplayIcon />
            </button>
          )}
          {onShowCode && (
            <button
              type="button"
              className="frame-code"
              title="Show the code this step walks through"
              onClick={onShowCode}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                aria-hidden="true"
              >
                <path
                  d="M5 4L2 7l3 3M9 4l3 3-3 3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Code
            </button>
          )}
          <button
            type="button"
            className="frame-arrow"
            aria-label="Previous step"
            // Kept enabled so focus never drops; the guard stops the step.
            aria-disabled={index === 0}
            onClick={() => index > 0 && onStep(index - 1)}
          >
            <Chevron direction="back" />
          </button>
          {index < last ? (
            <button
              type="button"
              className="frame-arrow frame-forward"
              aria-label="Next step"
              onClick={() => onStep(index + 1)}
            >
              <Chevron direction="forward" />
            </button>
          ) : (
            <button
              type="button"
              className="frame-arrow frame-forward frame-replay"
              onClick={() => onStep(0)}
            >
              <ReplayIcon />
              Replay
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Chevron({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d={direction === "back" ? "M8.5 3L4.5 7L8.5 11" : "M5.5 3L9.5 7L5.5 11"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2.5 7a4.5 4.5 0 1 0 1.3-3.2M2.5 2.5v2.3h2.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
