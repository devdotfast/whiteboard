import type { ReviewTocEntry } from "@canvas/review-document-headings";
import type { ReviewApiClient } from "@review/review-api/client";
import { createContext } from "react";

/** What the canvas gives its board editor. */
export interface BoardEditorHost {
  client: ReviewApiClient;
  /** The editor's Contents, as the person types. */
  setHeadings(entries: ReviewTocEntry[] | undefined): void;
}

export const BoardEditorHostContext = createContext<BoardEditorHost | null>(
  null,
);
