import type {
  ReviewApiSummary,
  ReviewGatewayHostState,
} from "@dev.fast/review-protocol";

import { LIST_MODES, type ListMode } from "./review-gateway-memory.js";

export interface ListSource {
  states: readonly ReviewGatewayHostState[];
  serving(serverId: string): boolean;
  serverIdOf(alias: string): string | undefined;
  list(serverId: string, mode: ListMode): ReviewApiSummary[] | undefined;
}

function decorate(
  entry: ReviewApiSummary,
  alias: string,
  hostState: NonNullable<ReviewApiSummary["hostState"]>,
): ReviewApiSummary {
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
    available: { sourceWindows: false, languageFeatures: false },
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

// Settings order, one entry per server: the first to list an id owns it.
function* servers(source: ListSource) {
  const seen = new Set<string>();

  for (const state of source.states) {
    const serverId = state.serverId ?? source.serverIdOf(state.alias);

    if (serverId === undefined || seen.has(serverId)) continue;
    seen.add(serverId);
    yield { state, serverId };
  }
}

export function listedBy(reviewId: string, source: ListSource) {
  for (const server of servers(source))
    if (
      LIST_MODES.some((mode) =>
        source
          .list(server.serverId, mode)
          ?.some((entry) => entry.reviewId === reviewId),
      )
    )
      return server;

  return undefined;
}

export function mergeLists(
  mode: ListMode,
  local: readonly ReviewApiSummary[],
  source: ListSource,
) {
  const ids = new Set(local.map((entry) => entry.reviewId));
  const merged = [...local];

  for (const { state, serverId } of servers(source)) {
    const hostState = hostStateOf(state, source.serving(serverId));

    for (const entry of source.list(serverId, mode) ?? [])
      if (!ids.has(entry.reviewId)) {
        ids.add(entry.reviewId);
        merged.push(decorate(entry, state.alias, hostState));
      }
  }

  return merged;
}
