import { describe, expect, it, vi } from "vitest";

import { scheduleC4NodeMeasurements } from "./c4-node-measurement";

describe("SoftwareMap node measurement", () => {
  it("measures C4 nodes even when animation frames are paused for a hidden editor tab", () => {
    const measure = vi.fn<() => void>();

    const cancel = scheduleC4NodeMeasurements(measure, {
      requestFrame: vi.fn<(callback: FrameRequestCallback) => number>(() => 17),
      cancelFrame: vi.fn<(frame: number) => void>(),
      setTimer: vi.fn<(callback: () => void, delay: number) => number>(
        () => 23,
      ),
      clearTimer: vi.fn<(timer: number) => void>(),
    });

    expect(measure).toHaveBeenCalledTimes(1);
    cancel();
  });
});
