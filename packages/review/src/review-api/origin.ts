import { z } from "zod";

import { pullRequestProvider } from "./provider.js";
import type { Snapshot } from "./store.js";

export const pullRequestUrl = z
  .string()
  .refine(
    (url) => pullRequestProvider(url) !== undefined,
    "Use a canonical GitHub PR URL: https://github.com/owner/repository/pull/123, or the same path on a GitHub Enterprise host.",
  );

/** One key per PR: GitHub owner and repository names are case-insensitive,
 * and the URL pattern admits only ASCII, so lowercasing is canonical. */
export function pullRequestKey(url: string): string {
  return url.toLowerCase();
}

/** Omission preserves identity; null detaches it without changing import metadata. */
export function setPullRequest(
  snapshot: Pick<Snapshot, "origin">,
  url: string | null | undefined,
) {
  if (url === undefined) return;

  if (url === null) {
    if (snapshot.origin) {
      delete snapshot.origin.pullRequestUrl;
      delete snapshot.origin.pullRequestNumber;
    }

    return;
  }

  snapshot.origin = {
    ...snapshot.origin,
    pullRequestUrl: url,
    pullRequestNumber: Number(url.split("/").at(-1)),
  };
}
