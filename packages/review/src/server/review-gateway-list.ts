import {
  type ReviewApiSummary,
  type ReviewGatewayHostState,
  reviewHostStatus,
} from "@dev.fast/review-protocol";

export interface ListSource {
  states: readonly ReviewGatewayHostState[];
  serving(serverId: string): boolean;
  serverIdOf(alias: string): string | undefined;
  list(serverId: string): ReviewApiSummary[] | undefined;
}

function decorate(
  entry: ReviewApiSummary,
  state: ReviewGatewayHostState,
  hostState: NonNullable<ReviewApiSummary["hostState"]>,
): ReviewApiSummary {
  const { alias } = state;
  const online = hostState === "online";
  const features = online && state.languageFeatures === true;

  const reason = online
    ? features
      ? undefined
      : state.languageFeaturesDetail
    : reviewHostStatus({
        alias,
        state: hostState,
        detail: hostState === state.state ? state.detail : undefined,
      }).sentence;

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
    available: {
      sourceWindows: features,
      ...(reason && { reason }),
      ...(online && state.languageFeaturesPending && { pending: true }),
    },
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
      source.list(server.serverId)?.some((entry) => entry.reviewId === reviewId)
    )
      return server;

  return undefined;
}

export function mergeLists(
  local: readonly ReviewApiSummary[],
  source: ListSource,
) {
  const ids = new Set(local.map((entry) => entry.reviewId));
  const merged = [...local];

  for (const { state, serverId } of servers(source)) {
    const hostState = hostStateOf(state, source.serving(serverId));

    for (const entry of source.list(serverId) ?? [])
      if (!ids.has(entry.reviewId)) {
        ids.add(entry.reviewId);
        merged.push(decorate(entry, state, hostState));
      }
  }

  return merged;
}
