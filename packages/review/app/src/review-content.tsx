import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useMemo, useRef } from "react";

import { AgentSelectionProvider } from "./agent-selection";
import type { RenderedReviewDocument } from "./App";
import { AskHistoryProvider } from "./ask-history";
import { ReviewDebugSettingsProvider } from "./debug-settings";
import { documentStyles } from "./document-styles";
import { appMarker, documentMarker } from "./markers.stylex";
import { ReviewProvider } from "./review-context";
import { ReviewFindProvider } from "./review-find";
import { useReviewPanelStore } from "./review-panel";
import { ReviewRootsProvider } from "./review-root-context";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";

/** Only the board's document: no top bar, views, rails or panels. */
export function ReviewContent({
  document,
  softwareMapEnabled,
}: {
  document: RenderedReviewDocument;
  softwareMapEnabled: boolean;
}): ReactElement {
  const panelStore = useReviewPanelStore();
  const articleRef = useRef<HTMLElement | null>(null);
  const appRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const scrollRegionRef = useRef<HTMLElement | null>(null);

  const roots = useMemo(
    () => ({ appRef, shellRef, scrollRegionRef, articleRef }),
    [],
  );

  return (
    <ReviewRootsProvider roots={roots}>
      <ReviewFindProvider articleRef={articleRef} documentKey={document.key}>
        <ReviewDebugSettingsProvider>
          <ReviewProvider
            documentRoute={document.routePath}
            softwareMapEnabled={softwareMapEnabled}
            openTraceSession={panelStore.getState().openTrace}
          >
            <AskHistoryProvider>
              <AgentSelectionProvider revision={document.key}>
                <div ref={appRef} {...stylex.props(appMarker, styles.root)}>
                  <article
                    ref={articleRef}
                    {...withClass(
                      "review-document",
                      documentStyles.article,
                      documentMarker,
                    )}
                  >
                    <document.render />
                  </article>
                </div>
              </AgentSelectionProvider>
            </AskHistoryProvider>
          </ReviewProvider>
        </ReviewDebugSettingsProvider>
      </ReviewFindProvider>
    </ReviewRootsProvider>
  );
}

const styles = stylex.create({
  root: {
    color: tokens.ink,
    backgroundColor: tokens.bg,
  },
});
