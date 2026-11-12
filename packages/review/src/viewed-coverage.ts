import * as z from "zod";

export {
  type CoverageFile,
  type CoverageProgress,
  coverageProgress,
  coverageSources,
  emptyCoverage,
  mergeCoverageProgress,
  scopedCoverage,
} from "@dev.fast/whiteboard-document";

export const coverageSchema = z.object({
  base: z.array(
    z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  ),
  head: z.array(
    z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  ),
});
