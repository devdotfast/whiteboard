import {
  type ReviewAgentTraceResponse,
  parseReviewAgentTraceResponse,
} from "@dev.fast/review-protocol";
import { skipToken, useQuery } from "@tanstack/react-query";

import { canvasQueryKeys } from "./canvas-query";
import { type ReviewSession, useReviewSession } from "./host/review-session";

export type LoadedAgentTrace = Extract<ReviewAgentTraceResponse, { ok: true }>;

export type AgentTraceState =
  | { status: "idle"; trace?: undefined; error?: undefined }
  | { status: "loading"; trace?: undefined; error?: undefined }
  | { status: "error"; error: string; trace?: undefined }
  | { status: "loaded"; trace: LoadedAgentTrace; error?: undefined };

export type AgentTraceStorage = "s3" | "hosted";

export function makeAgentTraceKey(
  sessionId: string,
  trace?: string | null,
  storage?: AgentTraceStorage | null,
): string {
  const base = trace ? `${sessionId}:${trace}` : sessionId;

  return storage ? `${base}@${storage}` : base;
}

export function makeAgentTraceUrl(
  sessionId: string,
  trace?: string | null,
  storage?: AgentTraceStorage | null,
): `/${string}` {
  const params = new URLSearchParams();

  if (trace) params.set("trace", trace);

  if (storage) params.set("storage", storage);
  const query = params.size > 0 ? `?${params.toString()}` : "";

  return `/agent-traces/${encodeURIComponent(sessionId)}${query}`;
}

async function readAgentTrace(
  reviewFetch: ReviewSession["fetch"],
  url: `/${string}`,
  signal: AbortSignal,
): Promise<LoadedAgentTrace> {
  const response = await reviewFetch(url, { signal });
  const result = parseReviewAgentTraceResponse(await response.json());

  if (!response.ok || !result.ok) {
    throw new Error(result.ok ? "Unable to load trace." : result.error);
  }

  return result;
}

/** Loads the currently selected trace for this component instance. */
export function useAgentTrace(
  sessionId?: string | null,
  trace?: string | null,
  storage?: AgentTraceStorage | null,
): AgentTraceState {
  const session = useReviewSession();

  const retained = sessionId
    ? session.review?.traces.get(makeAgentTraceKey(sessionId, trace))
    : undefined;

  // Full payloads can be large, so an unobserved trace leaves the cache soon
  // after the view moves away from it.
  const query = useQuery({
    queryKey: canvasQueryKeys.agentTrace(sessionId, trace, storage),
    queryFn:
      sessionId && !retained
        ? ({ signal }) =>
            readAgentTrace(
              session.fetch,
              makeAgentTraceUrl(sessionId, trace, storage),
              signal,
            )
        : skipToken,
    staleTime: 0,
    gcTime: 30_000,
  });

  if (retained) return { status: "loaded", trace: retained };

  if (!sessionId) return { status: "idle" };

  if (query.status === "error")
    return { status: "error", error: query.error.message };

  return query.data
    ? { status: "loaded", trace: query.data }
    : { status: "loading" };
}
