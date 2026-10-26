import type { ReviewApiClient } from "@review/review-api/client";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";

import { canvasQueryKeys } from "./canvas-query";

export interface SharingAccount {
  account: {
    login: string;
    origin: string;
    email?: string;
    githubLogin?: string;
  } | null;
  pending: boolean;
  userCode?: string;
  error?: string;
}

const POLL_WHILE_PENDING_MS = 2000;

export function useSharingAccount(
  client: ReviewApiClient | undefined,
  enabled = true,
) {
  const query = useQuery({
    queryKey: canvasQueryKeys.sharingAccount(),
    queryFn: client
      ? ({ signal }) => client.read<SharingAccount>("/sharing/account", signal)
      : skipToken,
    enabled,
    refetchInterval: (query) =>
      query.state.data?.pending ? POLL_WHILE_PENDING_MS : false,
    // Sign-in finishes in the browser, while this window is in the background.
    refetchIntervalInBackground: true,
  });

  const { refetch } = query;

  // The library's focus refresh follows visibility; this follows window focus.
  useEffect(() => {
    if (!client || !enabled) return;
    const refresh = () => void refetch();

    window.addEventListener("focus", refresh);

    return () => window.removeEventListener("focus", refresh);
  }, [client, enabled, refetch]);

  return query;
}

export function useSignIn(client: ReviewApiClient | undefined) {
  const queryClient = useQueryClient();
  const key = canvasQueryKeys.sharingAccount();

  return useMutation({
    mutationFn: () => client!.post("/sharing/login", {}),
    onSuccess: async () => {
      // An older read must not end the wait this login starts.
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<SharingAccount>(key, {
        account: null,
        pending: true,
      });
    },
  });
}

export function useSignOut(client: ReviewApiClient | undefined) {
  const queryClient = useQueryClient();
  const key = canvasQueryKeys.sharingAccount();

  return useMutation({
    mutationFn: () => client!.post<SharingAccount>("/sharing/logout", {}),
    onSuccess: async (account) => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, account);
    },
  });
}
