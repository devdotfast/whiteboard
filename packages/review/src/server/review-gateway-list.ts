import type {
  ReviewApiSummary,
  ReviewGatewayHostState,
} from "@dev.fast/review-protocol";

import { UUID } from "./review-gateway-hosts.js";
import type { ListMode } from "./review-gateway-memory.js";

export interface ListSource {
  states: readonly ReviewGatewayHostState[];
  serving(serverId: string): boolean;
  serverIdOf(alias: string): string | undefined;
  list(serverId: string, mode: ListMode): ReviewApiSummary[] | undefined;
}

function decorate(
  entry: ReviewApiSummary,
  state: ReviewGatewayHostState,
  hostState: NonNullable<ReviewApiSummary["hostState"]>,
): ReviewApiSummary {
  const { alias } = state;
  const features = hostState === "online" && state.languageFeatures === true;

  return {
    ...entry,
    ...(entry.repositoryGroup && {
      repositoryGroup: {
        key: `${alias}:${entry.repositoryGroup.key}`,
        label: entry.repositoryGroup.label,
      },
    }),
    host: alias,
    hostState,
    available: { sourceWindows: features, languageFeatures: features },
  };
}

const hostStateOf = (
  state: ReviewGatewayHostState,
  serving: boolean,
): NonNullable<ReviewApiSummary["hostState"]> => {
  if (serving) return "online";

  return state.state === "online" || state.state === "duplicate"
    ? "offline"
    : state.state;
};

function remoteEntries(mode: ListMode, source: ListSource) {
  const entries: ReviewApiSummary[] = [];
  const seen = new Set<string>();

  for (const state of source.states) {
    if (state.state === "duplicate") continue;
    const serverId = state.serverId ?? source.serverIdOf(state.alias);

    if (serverId === undefined || seen.has(serverId)) continue;
    seen.add(serverId);
    const hostState = hostStateOf(state, source.serving(serverId));

    for (const entry of source.list(serverId, mode) ?? [])
      if (UUID.test(entry.reviewId))
        entries.push(decorate(entry, state, hostState));
  }

  return entries;
}

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
