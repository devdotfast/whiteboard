import type { ReviewApiClient } from "@review/review-api/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo } from "react";

import type { AgentTraceStorage } from "./use-agent-trace";

/**
 * Every canvas request goes to the local review API or the desktop bridge,
 * which answer without internet access and report failures of the remote
 * work they do themselves. Queries run regardless of `navigator.onLine`,
 * fail on the first error as the hand-written requests did, and refresh only
 * where a resource asks to.
 */
export function createCanvasQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { networkMode: "always", retry: false },
    },
  });
}

/**
 * Each ApiCanvas owns one client, so its backend and review are the cache
 * boundary and keys name only what varies within one canvas.
 */
export const canvasQueryKeys = {
  sharingAccount: () => ["sharing", "account"] as const,
  shareLink: (version: number | undefined) =>
    ["sharing", "link", version] as const,
  traceList: (
    version: number | undefined,
    pins: { base: string; head: string } | undefined,
    storage: AgentTraceStorage | null,
  ) => ["agent-traces", version, pins?.base, pins?.head, storage] as const,
  agentTrace: (
    sessionId: string | null | undefined,
    trace: string | null | undefined,
    storage: AgentTraceStorage | null | undefined,
  ) => ["agent-trace", sessionId, trace ?? null, storage ?? null] as const,
  askThread: (threadId: string) => ["ask-thread", threadId] as const,
  diffFiles: (documentKey: string, source: number, revision?: string) =>
    ["diff-files", documentKey, source, revision] as const,
  lensProgress: (version: number) => ["lens-progress", version] as const,
  allLensProgress: () => ["lens-progress"] as const,
  place: (version: number | undefined) => ["place", "board", version] as const,
  stack: (version: number | undefined) => ["place", "stack", version] as const,
  allPlace: () => ["place"] as const,
  projectBoards: () => ["project-boards"] as const,
  askThreads: () => ["ask-threads"] as const,
  askBoards: (threadId: string | null, turns: number) =>
    ["ask-boards", threadId, turns] as const,
  linkStates: () => ["link-states"] as const,
  linkPeek: (
    board: string,
    block: string | undefined,
    updatedAt: string | undefined,
  ) => ["link-peek", board, block ?? null, updatedAt ?? null] as const,
};

const pendingDisposals = new WeakMap<
  QueryClient,
  ReturnType<typeof setTimeout>
>();

let nextScope = 0;

export interface CanvasQueryScope {
  id: number;
  queryClient: QueryClient;
}

/** Clearing is deferred so a Strict Mode replay keeps its client. */
export function useCanvasQueryScope(
  client: ReviewApiClient,
  reviewId: string,
): CanvasQueryScope {
  const scope = useMemo(
    () => ({ id: nextScope++, queryClient: createCanvasQueryClient() }),
    [client, reviewId],
  );

  const { queryClient } = scope;

  useEffect(() => {
    clearTimeout(pendingDisposals.get(queryClient));

    return () => {
      pendingDisposals.set(
        queryClient,
        setTimeout(() => queryClient.clear()),
      );
    };
  }, [queryClient]);

  return scope;
}

/** A new scope remounts its queries. */
export function CanvasQueryProvider({
  scope,
  children,
}: {
  scope: CanvasQueryScope;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider key={scope.id} client={scope.queryClient}>
      {children}
    </QueryClientProvider>
  );
}
