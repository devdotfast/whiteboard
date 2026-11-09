import { z } from "zod";

export {
  type ChangeCounts,
  type Coverage,
  type CoverageFile,
  type CoverageProgress,
  type LineInterval,
  changeCounts,
  coverageProgress,
  coverageSources,
  emptyCoverage,
  intersectIntervals,
  mergeCoverageProgress,
  scopedCoverage,
  sourcesForFile,
  subtractIntervals,
  unionIntervals,
  updateCoverage,
} from "@dev.fast/whiteboard-document";

export const coverageSchema = z.object({
  base: z.array(
    z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  ),
  head: z.array(
    z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  ),
});
