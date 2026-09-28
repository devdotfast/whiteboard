import {
  type ReviewAgentTraceSession,
  parseReviewAgentTraceListResponse,
} from "@dev.fast/review-protocol";
import { useQuery } from "@tanstack/react-query";
import { useContext } from "react";

import { canvasQueryKeys } from "./canvas-query";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { type ReviewSession, useReviewSession } from "./host/review-session";
import type { AgentTraceStorage } from "./use-agent-trace";

export type TraceListState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "loaded";
      configured: boolean;
      storage: AgentTraceStorage | null;
      sources: AgentTraceStorage[];
      storageError: string | null;
      sessions: ReviewAgentTraceSession[];
    };

type LoadedTraceList = Extract<TraceListState, { status: "loaded" }>;

async function readTraceList(
  reviewFetch: ReviewSession["fetch"],
  storage: AgentTraceStorage | null,
  signal: AbortSignal,
): Promise<LoadedTraceList> {
  const response = await reviewFetch(
    storage ? `/agent-traces?storage=${storage}` : "/agent-traces",
    { signal },
  );

  const result = parseReviewAgentTraceListResponse(await response.json());

  if (!response.ok || !result.ok) {
    throw new Error(result.ok ? "Unable to load agent traces." : result.error);
  }

  return {
    status: "loaded",
    configured: result.configured !== false,
    storage:
      result.storage === "s3" || result.storage === "hosted"
        ? result.storage
        : null,
    sources: result.sources ?? [],
    storageError: result.storageError ?? null,
    sessions: result.sessions,
  };
}

export function useTraceList(
  storageOverride: AgentTraceStorage | null = null,
  provided?: TraceListState,
): TraceListState {
  const session = useReviewSession();
  const version = useContext(DisplayedReviewVersionContext);
  const usesProvided = provided !== undefined && !storageOverride;

  // The session reads the displayed version's traces, stored beside its pins.
  const query = useQuery({
    queryKey: canvasQueryKeys.traceList(
      version,
      session.review?.pins,
      storageOverride,
    ),
    queryFn: ({ signal }) =>
      readTraceList(session.fetch, storageOverride, signal),
    enabled: !usesProvided,
    // Each view that mounts rereads; switching storage shows its last list.
    staleTime: 0,
  });

  if (usesProvided) return provided;

  if (query.status === "error")
    return { status: "error", error: query.error.message };

  return query.data ?? { status: "loading" };
}
