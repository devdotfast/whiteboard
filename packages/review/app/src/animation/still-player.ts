// A diagram with no steps and no timeline: one still drawing. It has a
// single stop, for rendering, and no controls under the stage.

import type { StagePlayer } from "./stage-player";

/** The one stop a still diagram renders at. */
export const STILL_STOP = "diagram";

export function stillPlayer(title: string): StagePlayer {
  return {
    stops: [{ key: STILL_STOP, title }],
    activeIndex: 0,
    pick() {},
    boot: () => ({
      mode: "frames",
      frames: [],
      markers: [],
      scenarios: [],
      frame: 0,
    }),
    receive() {},
    scenario: undefined,
    selectScenario() {},
    strip: null,
    controls: null,
    onKeyDown() {},
  };
}
