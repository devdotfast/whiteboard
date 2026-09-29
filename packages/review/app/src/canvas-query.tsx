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
  diffFiles: (documentKey: string, source: number, revision?: string) =>
    ["diff-files", documentKey, source, revision] as const,
  reviewStack: (
    version: number | undefined,
    pullRequestNumber: number | null,
    pullRequestUrl: string | null,
  ) => ["review-stack", version, pullRequestNumber, pullRequestUrl] as const,
  lensProgress: (version: number, mode: "structural" | "textual") =>
    ["lens-progress", version, mode] as const,
  allLensProgress: () => ["lens-progress"] as const,
};

const pendingDisposals = new WeakMap<
  QueryClient,
  ReturnType<typeof setTimeout>
>();

let nextScope = 0;

export function CanvasQueryProvider({
  client,
  reviewId,
  children,
}: {
  client: ReviewApiClient;
  reviewId: string;
  children: ReactNode;
}) {
  const scope = useMemo(
    () => ({ id: nextScope++, queryClient: createCanvasQueryClient() }),
    [client, reviewId],
  );

  const { queryClient } = scope;

  // Clearing cancels in-flight reads and drops the cache. Deferring it lets a
  // Strict Mode effect replay keep the client it immediately remounts.
  useEffect(() => {
    clearTimeout(pendingDisposals.get(queryClient));

    return () => {
      pendingDisposals.set(
        queryClient,
        setTimeout(() => queryClient.clear()),
      );
    };
  }, [queryClient]);

  // Queries bind to the client they mount with, so a new scope remounts them.
  return (
    <QueryClientProvider key={scope.id} client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
