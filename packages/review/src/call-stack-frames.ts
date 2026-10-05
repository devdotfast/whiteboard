import type { Frame } from "./review-api/document";

/** Matching identity: an explicit key, else the source range. React and
 * selection identity stay on `id`. */
export function frameIdentity(frame: Frame): string {
  return frame.key ?? frame.source;
}
