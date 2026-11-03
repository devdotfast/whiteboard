// What differs between an animation, whose reader steps through frames, and
// a clip, whose reader plays one timeline and jumps between its markers. The
// block around either (the stage, its slots, the tour, painting in) is the
// same; each kind supplies one of these.

import type { KeyboardEvent, ReactNode } from "react";

import type { HostMessage, StageInit, StageMessage } from "./stage-protocol";

/** One stop of the path showing: a frame, or one of a clip's markers. */
export interface PlayerStop {
  key: string;
  title: string;
  caption?: string;
  /** The code names the stop lists, for its tour stop. */
  code?: string[];
}

/** Who picked a stop: the controls under the stage, or the tour. */
export type PickedBy = "controls" | "tour";

export type StageSend = (message: HostMessage) => void;

/** How far the frame showing has run while playing: the fraction reached
 * when it was read, the milliseconds left to run, and whether it is running
 * or holding (paused, or full and waiting for the stage to settle). */
export interface FrameTimer {
  fraction: number;
  remaining: number;
  running: boolean;
}

export interface StagePlayer {
  /** The stops of the path showing, in order. */
  stops: readonly PlayerStop[];
  /** The stop showing, in `stops`. */
  activeIndex: number;
  /** Show the stop at `position`, as the reader asked through `by`. */
  pick(position: number, by: PickedBy): void;
  /** The kind's part of a new stage's first message; resets what the last
   * stage reported. */
  boot(): Pick<
    StageInit,
    | "mode"
    | "frames"
    | "markers"
    | "scenarios"
    | "frame"
    | "sequence"
    | "scenario"
  >;
  /** A message only this kind's stage sends. */
  receive(message: StageMessage): void;
  /** The scenario showing, by key. */
  scenario: string | undefined;
  selectScenario(key: string): void;
  /** The strip of named stops under the stage, when there is one, with the
   * clock of the stop showing while frames play. */
  strip: {
    label: string;
    items: { key: string; text: string }[];
    timer?: FrameTimer | null;
  } | null;
  /** Drawn right under the stage. */
  afterStage?: ReactNode;
  /** The footer's controls and caption. */
  controls: ReactNode;
  /** Keys pressed in the strip or the controls. */
  onKeyDown(event: KeyboardEvent): void;
  /** Keys pressed on the figure itself, which takes focus when set. */
  onFigureKeyDown?(event: KeyboardEvent): void;
}
