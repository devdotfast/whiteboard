import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { type Timeline, positionAt, timelineDuration } from "./model";

/** How far one arrow key moves the playhead. */
const STEP = 1000;

/**
 * Plays a block's timeline: play, pause or replay, a track split into its
 * chapters with a thumb at the playhead, the time, the chapters' names and
 * the current chapter's caption. The player owns the clock and reports
 * every new time through `onTime`; the stage draws that moment.
 *
 * Space plays and pauses from anywhere in the player; Left and Right move a
 * second, Home and End jump to the ends. Dragging the track scrubs, pausing
 * while the pointer is down and carrying on afterwards if it was playing.
 */
export function Player({
  timeline,
  width,
  onTime,
}: {
  timeline: Timeline;
  /** The stage's width; the player lines up with it. */
  width: number;
  onTime(time: number): void;
}) {
  const duration = timelineDuration(timeline);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const segments = useRef<(HTMLDivElement | null)[]>([]);
  const resume = useRef(false);

  const ended = time >= duration && !playing;
  const position = positionAt(timeline, Math.min(time, duration));
  const chapter = position?.chapter;

  useEffect(() => onTime(time), [time, onTime]);

  // The clock: advance by real time each animation frame while playing.
  useEffect(() => {
    if (!playing) return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;

      setTime((current) => {
        const next = Math.min(current + elapsed, duration);

        if (next >= duration) setPlaying(false);

        return next;
      });

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);

  const seek = (next: number) => setTime(Math.min(Math.max(next, 0), duration));

  const toggle = () => {
    if (ended) {
      setTime(0);
      setPlaying(true);
    } else setPlaying(!playing);
  };

  // A pointer's x on the track, as a time: the chapter under it, and how far
  // into that chapter. The gap between two chapters splits down the middle.
  const timeAt = (x: number) => {
    let start = 0;

    for (const [index, item] of timeline.chapters.entries()) {
      const rect = segments.current[index]?.getBoundingClientRect();
      const next = segments.current[index + 1]?.getBoundingClientRect();

      if (rect && (!next || x < (rect.right + next.left) / 2)) {
        const share = rect.width
          ? Math.min(Math.max((x - rect.left) / rect.width, 0), 1)
          : 0;

        return start + share * item.duration;
      }

      start += item.duration;
    }

    return duration;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resume.current = playing;
    setPlaying(false);
    setScrubbing(true);
    seek(timeAt(event.clientX));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (scrubbing) seek(timeAt(event.clientX));
  };

  const onPointerUp = () => {
    if (!scrubbing) return;
    setScrubbing(false);

    if (resume.current && time < duration) setPlaying(true);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Space on a button presses it; everywhere else it plays and pauses.
    if (event.key === " " && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      toggle();

      return;
    }

    const next = {
      ArrowLeft: time - STEP,
      ArrowRight: time + STEP,
      Home: 0,
      End: duration,
    }[event.key];

    if (next === undefined) return;
    event.preventDefault();
    seek(next);
  };

  let start = 0;

  const chapters = timeline.chapters.map((item, index) => {
    const from = start;
    start += item.duration;

    return { item, index, from };
  });

  const hint = ended
    ? undefined
    : `Space to ${playing ? "pause" : "play"} · ← → to scrub`;

  return (
    // Keys from any control in the player play, pause and scrub.
    <div
      className="player"
      data-ended={ended || undefined}
      style={{ maxWidth: width }}
      onKeyDown={onKeyDown}
    >
      <div className="player-row">
        <button
          type="button"
          className="player-toggle"
          data-state={ended ? "ended" : playing ? "playing" : "paused"}
          aria-label={ended ? "Replay" : playing ? "Pause" : "Play"}
          onClick={toggle}
        >
          {ended ? <ReplayIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="player-track-area">
          <div
            className="player-track"
            role="slider"
            tabIndex={0}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${clock(time, true)} of ${clock(duration)}${chapter?.label ? `, ${chapter.label}` : ""}`}
            data-scrubbing={scrubbing || undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {chapters.map(({ item, index, from }) => {
              // A chapter with no length is done once the time reaches it.
              const share = item.duration
                ? Math.min(Math.max((time - from) / item.duration, 0), 1)
                : Number(time >= from);

              const current = index === position?.chapterIndex;

              return (
                <div
                  key={item.id}
                  ref={(element) => {
                    segments.current[index] = element;
                  }}
                  className="player-segment"
                  style={{ flexGrow: item.duration }}
                >
                  <span
                    className="player-fill"
                    style={{ width: `${share * 100}%` }}
                  />
                  {current && !ended && (
                    <span
                      className="player-thumb"
                      style={{ left: `${share * 100}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {!ended && (
            <div className="player-chapters">
              {chapters.map(({ item, index, from }) => (
                <button
                  key={item.id}
                  type="button"
                  className="player-chapter"
                  aria-current={
                    index === position?.chapterIndex ? "step" : undefined
                  }
                  style={{ flexGrow: item.duration }}
                  title={item.caption}
                  onClick={() => seek(from)}
                >
                  {item.label ?? `Part ${index + 1}`}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="player-time" data-scrubbing={scrubbing || undefined}>
          {clock(time, !ended && time > 0)}{" "}
          <span className="player-total">/ {clock(duration)}</span>
        </span>
      </div>
      <div className="player-caption-row">
        <p className="player-caption" aria-live="polite">
          {chapter?.label && (
            <span className="player-chapter-name">{chapter.label}</span>
          )}
          {chapter?.caption}
        </p>
        {hint && <span className="player-hint">{hint}</span>}
      </div>
    </div>
  );
}

/** 2400 → "0:02.4" with tenths, "0:02" without. */
function clock(ms: number, tenths = false) {
  const seconds = Math.max(ms, 0) / 1000;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;

  const shown = tenths
    ? (Math.floor(rest * 10) / 10).toFixed(1).padStart(4, "0")
    : String(Math.round(rest)).padStart(2, "0");

  return `${minutes}:${shown}`;
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.5 2.2v7.6L9.8 6z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.5" y="2" width="2.2" height="8" rx="0.6" fill="currentColor" />
      <rect x="7.3" y="2" width="2.2" height="8" rx="0.6" fill="currentColor" />
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
