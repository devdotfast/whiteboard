import type { ReviewCanvasBridge } from "@dev.fast/review-protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
} from "react";

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

/** Desktop shares one client across boards, so board keys name the board. */
export const canvasQueryKeys = {
  sharingAccount: () => ["sharing", "account"] as const,
  shareLink: (board: string, version: number | undefined) =>
    ["sharing", "link", board, version] as const,
  traceList: (
    board: string,
    version: number | undefined,
    pins: { base: string; head: string } | undefined,
    storage: AgentTraceStorage | null,
  ) =>
    ["agent-traces", board, version, pins?.base, pins?.head, storage] as const,
  agentTrace: (
    board: string,
    sessionId: string | null | undefined,
    trace: string | null | undefined,
    storage: AgentTraceStorage | null | undefined,
  ) =>
    ["agent-trace", board, sessionId, trace ?? null, storage ?? null] as const,
  askThread: (threadId: string) => ["ask-thread", threadId] as const,
  diffFiles: (
    board: string,
    documentKey: string,
    source: number,
    revision?: string,
  ) => ["diff-files", board, documentKey, source, revision] as const,
  lensProgress: (board: string, version: number) =>
    ["lens-progress", board, version] as const,
  allLensProgress: (board: string) => ["lens-progress", board] as const,
  board: (board: string, version: number | undefined) =>
    ["board", board, version ?? "latest"] as const,
  place: (board: string, version: number | undefined) =>
    ["place", board, "board", version] as const,
  placeRevision: (board: string) => ["place-revision", board] as const,
  stack: (board: string, version: number | undefined) =>
    ["place", board, "stack", version] as const,
  allPlace: (board: string) => ["place", board] as const,
  projectBoards: (board: string) => ["project-boards", board] as const,
  askThreads: (board: string) => ["ask-threads", board] as const,
  askAgents: (host: string) => ["ask-agents", host] as const,
  askBoards: (threadId: string | null, turns: number) =>
    ["ask-boards", threadId, turns] as const,
  linkStates: (board: string) => ["link-states", board] as const,
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

/** Desktop's canvas client, kept across the boards it shows. */
export const SharedCanvasQueryClient = createContext<QueryClient | null>(null);

/** A client whose queries stay idle, for a host that serves no requests. */
function createIdleQueryClient(): QueryClient {
  const client = createCanvasQueryClient();
  const defaults = client.defaultQueryOptions.bind(client);

  client.defaultQueryOptions = (options) => ({
    ...defaults(options),
    enabled: false,
  });

  return client;
}

/** The shared client, else one owned by the canvas. Clearing is deferred so
 * a Strict Mode replay keeps its client. A host without `request` gets an
 * idle client of its own. */
export function useCanvasQueryScope(
  host: Pick<ReviewCanvasBridge, "request">,
  reviewId: string,
): CanvasQueryScope {
  const shared = useContext(SharedCanvasQueryClient);

  const scope = useMemo(
    () => ({
      id: nextScope++,
      queryClient: host.request
        ? (shared ?? createCanvasQueryClient())
        : createIdleQueryClient(),
    }),
    [shared, host, reviewId],
  );

  const { queryClient } = scope;

  useEffect(() => {
    if (queryClient === shared) return;
    clearTimeout(pendingDisposals.get(queryClient));

    return () => {
      pendingDisposals.set(
        queryClient,
        setTimeout(() => queryClient.clear()),
      );
    };
  }, [queryClient, shared]);

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
