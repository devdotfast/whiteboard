// What happened when a canvas last ran each animation's script. The script
// runs only in a canvas, so this is how an agent learns that the HTML it
// published threw. Kept in memory: a restart forgets it, and the next canvas
// to draw the animation reports again.

import { z } from "zod";

/** A canvas's report: the animation's script threw this, or nothing. */
export const animationReportSchema = z.strictObject({
  blockId: z.string().min(1),
  error: z.string().max(2000).nullable(),
});

/** A report, with the version the canvas showed when it ran. */
export type AnimationRun = z.infer<typeof animationReportSchema> & {
  version: number;
};

export class AnimationRuns {
  private readonly runs = new Map<string, Map<string, AnimationRun>>();

  record(reviewId: string, run: AnimationRun): void {
    const runs = this.runs.get(reviewId) ?? new Map<string, AnimationRun>();
    const kept = runs.get(run.blockId);

    // A clean boot, as when the block goes fullscreen, does not clear an
    // error the same animation threw on a later frame.
    if (kept?.error && run.error === null && kept.version === run.version)
      return;

    runs.set(run.blockId, run);
    this.runs.set(reviewId, runs);
  }

  /** Each animation's last run, by block id. */
  of(reviewId: string): ReadonlyMap<string, AnimationRun> {
    return this.runs.get(reviewId) ?? new Map();
  }

  /** Forgets the runs of blocks that changed: their next run reports anew. */
  forget(reviewId: string, blockIds: readonly string[]): void {
    const runs = this.runs.get(reviewId);

    if (!runs) return;

    for (const id of blockIds) runs.delete(id);

    if (!runs.size) this.runs.delete(reviewId);
  }

  drop(reviewId: string): void {
    this.runs.delete(reviewId);
  }
}
