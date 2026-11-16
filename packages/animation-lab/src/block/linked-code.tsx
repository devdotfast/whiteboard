import { CodePeekCard } from "@canvas/CodePeek";
import { ReviewSessionProvider } from "@canvas/host/review-session";
import type { ReviewLensView } from "@canvas/review-lenses";
import { testReviewSession } from "@canvas/review-session-test-utils";
import { staticPeeks } from "@canvas/share/peeks";
import { themeStyles } from "@canvas/theme-styles";
import { parseAnchor, sourceAnchors } from "@dev.fast/whiteboard-document";
import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useEffect, useMemo } from "react";

import "@canvas/global.css";

import type { Repo } from "./verify";

/** The mock repository's commit; every anchor reads at head. */
const HEAD = "b".repeat(40);

// Every selection resolves to its own lines: the lab has no diff to align.
const lenses: ReviewLensView = {
  progress: null,
  error: null,
  resolve: (selections) => selections.flatMap(sourceAnchors),
};

const settings = {
  currentDiffLayout: () => "unified" as const,
  onDidChangeDiffLayout: () => ({ dispose() {} }),
  currentInlineLineNumbers: () => true,
  onDidChangeInlineLineNumbers: () => ({ dispose() {} }),
};

/**
 * The canvas's own code peek, reading the lab's mock repository the way the
 * share viewer reads a board's quoted lines. Wrap the code view in it once;
 * each `LinkedCode` inside draws one anchor.
 */
export function LinkedCodeHost({
  repo,
  children,
}: {
  repo: Repo;
  children: ReactNode;
}) {
  const peeks = useMemo(() => staticPeeks(settings), []);

  const session = useMemo(
    () => testReviewSession({}, { peeks, currentTheme: () => "system" }),
    [peeks],
  );

  useEffect(() => {
    void peeks.setSources({
      pins: { repositoryId: "lab", base: HEAD, head: HEAD },
      sources: Object.entries(repo).map(([file, text]) => ({
        kind: "excerpt",
        file,
        commit: HEAD,
        fromLine: 1,
        lines: text.split("\n"),
      })),
    });
  }, [peeks, repo]);

  const theme = stylex.props(themeStyles.vars, themeStyles.system);

  return (
    <ReviewSessionProvider session={session}>
      <div
        className={`review-canvas-root linked-code ${theme.className ?? ""}`}
        style={theme.style}
      >
        {children}
      </div>
    </ReviewSessionProvider>
  );
}

/** One anchor's lines, as a code peek. */
export function LinkedCode({ anchor }: { anchor: string }) {
  const source = useMemo(() => parseAnchor(anchor), [anchor]);

  if (!source) return null;

  return <CodePeekCard source={source} lenses={lenses} heightMode="content" />;
}
