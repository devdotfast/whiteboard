import type {
  ReviewApiSummary,
  ReviewGatewayHostState,
} from "@dev.fast/review-protocol";

import { UUID } from "./review-gateway-hosts.js";
import type { ListMode } from "./review-gateway-memory.js";

/** What merging needs to know about the hosts and their last lists. */
export interface ListSource {
  /** Host states in the setting's order. */
  states: readonly ReviewGatewayHostState[];
  /** A host answers for this server id now. */
  serving(serverId: string): boolean;
  /** The server id last recorded under an alias that has not reported. */
  serverIdOf(alias: string): string | undefined;
  /** The last list a server sent. */
  list(serverId: string, mode: ListMode): ReviewApiSummary[] | undefined;
}

function decorate(
  entry: ReviewApiSummary,
  alias: string,
  hostState: NonNullable<ReviewApiSummary["hostState"]>,
): ReviewApiSummary {
  return {
    ...entry,
    // Two machines' repositories at one path stay two groups.
    ...(entry.repositoryGroup && {
      repositoryGroup: {
        key: `${alias}:${entry.repositoryGroup.key}`,
        label: entry.repositoryGroup.label,
      },
    }),
    host: alias,
    hostState,
    available: { sourceWindows: false, languageFeatures: false },
  };
}

const hostStateOf = (
  state: ReviewGatewayHostState,
  serving: boolean,
): NonNullable<ReviewApiSummary["hostState"]> => {
  if (serving) return "online";

  // Online but not the machine's serving alias: nothing answers for it.
  return state.state === "online" || state.state === "duplicate"
    ? "offline"
    : state.state;
};

/** Each machine's last list, in the setting's order, under its first alias. */
function remoteEntries(mode: ListMode, source: ListSource) {
  const entries: ReviewApiSummary[] = [];
  const seen = new Set<string>();

  for (const state of source.states) {
    // A copy's reviews are its machine's.
    if (state.state === "duplicate") continue;
    const serverId = state.serverId ?? source.serverIdOf(state.alias);

    if (serverId === undefined || seen.has(serverId)) continue;
    seen.add(serverId);
    const hostState = hostStateOf(state, source.serving(serverId));

    for (const entry of source.list(serverId, mode) ?? [])
      if (UUID.test(entry.reviewId))
        entries.push(decorate(entry, state.alias, hostState));
  }

  return entries;
}

/**
 * The laptop's entries, then each machine's. The first machine to list an id
 * keeps it; `conflict` hears about each later one.
 */
export function mergeLists(
  mode: ListMode,
  laptop: readonly ReviewApiSummary[],
  source: ListSource,
  conflict: (entry: ReviewApiSummary) => void = () => {},
) {
  const ids = new Set(laptop.map((entry) => entry.reviewId));
  const merged = [...laptop];

  for (const entry of remoteEntries(mode, source)) {
    if (ids.has(entry.reviewId)) {
      conflict(entry);
      continue;
    }

    ids.add(entry.reviewId);
    merged.push(entry);
  }

  return merged;
}
