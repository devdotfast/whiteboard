export type ReviewTocLevel = "h2" | "h3";

export interface ReviewTocEntry {
  id: string;
  text: string;
  level: ReviewTocLevel;
  /** How deep the heading's section is, 1 at the top. Without it, an h2 is
   * a section and an h3 one level under it. */
  depth?: number;
}

/** How deep `entry`'s section is, 1 at the top. */
export function headingDepth(entry: ReviewTocEntry): number {
  return entry.depth ?? (entry.level === "h2" ? 1 : 2);
}
