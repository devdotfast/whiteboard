import { z } from "zod";

import { pullRequestProvider } from "./provider.js";
import type { Snapshot } from "./store.js";

export const pullRequestUrl = z
  .string()
  .refine(
    (url) => pullRequestProvider(url) !== undefined,
    "Use a canonical PR URL: https://github.com/owner/repository/pull/123, the same path on a GitHub Enterprise host, or https://dev.azure.com/org/project/_git/repository/pullrequest/123.",
  );

/** One key per PR: GitHub owner and repository names are case-insensitive,
 * and the URL pattern admits only ASCII, so lowercasing is canonical. */
export function pullRequestKey(url: string): string {
  return url.toLowerCase();
}

/** Older snapshots kept origin/ on remote branch labels. */
export const sourceBranchName = (branch: string | undefined) =>
  branch?.replace(/^origin\//, "");

/** Omission preserves identity; null removes the PR without changing import
 * metadata. A new url clears a detach and keeps the title and PR base when the
 * caller omits them for the same PR. */
export function setPullRequest(
  snapshot: Pick<Snapshot, "origin">,
  url: string | null | undefined,
  title?: string,
  baseBranch?: string,
) {
  if (url === undefined) return;

  if (url === null) {
    if (snapshot.origin) {
      delete snapshot.origin.pullRequestUrl;
      delete snapshot.origin.pullRequestNumber;
      delete snapshot.origin.pullRequestTitle;
      delete snapshot.origin.pullRequestBaseBranch;
      delete snapshot.origin.pullRequestDetached;
    }

    return;
  }

  const same = snapshot.origin?.pullRequestUrl === url;
  const { pullRequestDetached: _detached, ...origin } = snapshot.origin ?? {};
  snapshot.origin = {
    ...origin,
    pullRequestUrl: url,
    pullRequestNumber: Number(url.split("/").at(-1)),
    pullRequestTitle:
      title ?? (same ? snapshot.origin?.pullRequestTitle : undefined),
    pullRequestBaseBranch:
      baseBranch ?? (same ? snapshot.origin?.pullRequestBaseBranch : undefined),
  };
}
