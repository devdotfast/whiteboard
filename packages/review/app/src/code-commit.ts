import type {
  ReviewCodeCommit,
  ReviewDiffSide,
  ReviewSourcePins,
} from "@dev.fast/review-protocol";
import { useContext, useEffect, useState } from "react";

import { BoardCommitsContext } from "./board-commits";
import { useOptionalReviewSession } from "./host/review-session";

interface CommitInfo {
  commit: string;
  subject: string;
  author: string;
  authoredAt: string;
  behind?: { count: number; branch: string };
}

const SHORT = 7;

// Commits never change, so each is described once per page.
const known = new Map<string, CommitInfo>();

/**
 * The commit a quote's header names: set only when its code is read at a
 * commit other than the board's own head or base, as every quote in a plan
 * is. Hovering it says what the commit is, once that has loaded.
 */
export function useCodeCommit(
  pins: ReviewSourcePins | undefined,
  side: ReviewDiffSide,
): ReviewCodeCommit | undefined {
  const session = useOptionalReviewSession();
  const boardCommits = useContext(BoardCommitsContext);

  const commit = pins
    ? side === "base"
      ? (pins.base ?? pins.head)
      : pins.head
    : undefined;

  const shown =
    session && boardCommits && commit && !boardCommits.includes(commit)
      ? commit
      : undefined;

  const [data, setData] = useState<CommitInfo | undefined>(() =>
    shown ? known.get(shown) : undefined,
  );

  useEffect(() => {
    if (!shown || !session) return;

    const cached = known.get(shown);

    if (cached) {
      setData(cached);

      return;
    }

    let current = true;

    // A commit that can't be described still shows its ID.
    void session
      .fetch(`/commit/${shown}`)
      .then(async (response) => {
        if (!response.ok) return;
        // SAFETY: /commit/:commit answers with these fields.
        const info = (await response.json()) as CommitInfo;

        known.set(shown, info);

        if (current) setData(info);
      })
      .catch(() => {});

    return () => {
      current = false;
    };
  }, [shown, session]);

  if (!shown) return undefined;

  const label = shown.slice(0, SHORT);

  return {
    label,
    ...(data?.commit === shown && {
      tooltip: { label: data.subject, detail: detail(data) },
    }),
  };
}

/** For example "d334066 · Ada · Oct 6 · 12 behind main". */
function detail(info: CommitInfo): string {
  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(Date.parse(info.authoredAt));

  const behind = info.behind
    ? info.behind.count
      ? `${info.behind.count} behind ${info.behind.branch}`
      : `at ${info.behind.branch}`
    : undefined;

  return [info.commit.slice(0, SHORT), info.author, date, behind]
    .filter(Boolean)
    .join(" · ");
}
