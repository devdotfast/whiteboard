import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import {
  type ReviewApiClient,
  ReviewApiError,
} from "../../src/review-api/client";

import "./share-control.css";
import { canvasQueryKeys } from "./canvas-query";
import { copyText } from "./copy-text";
import { useOptionalReviewSession } from "./host/review-session";
import { ShareIcon } from "./icons";
import { captureUiEvent } from "./ui-telemetry";
import { useDismissOnOutside } from "./use-dismiss-on-outside";
import { useTooltip } from "./use-tooltip";
import { useTopbarPopover } from "./use-topbar-popover";

export const SharingContext = createContext<{
  client: ReviewApiClient;
  reviewId: string;
  version: number;
  sender?: string;
  cloneUrl?: string;
} | null>(null);

interface SharingAccount {
  account: { login: string; origin: string } | null;
  pending: boolean;
  error?: string;
}

/** The version a popover shares, frozen when it opens, and the idempotency
 * key the host deduplicates its upload by. */
interface ShareTarget {
  version: number;
  requestId: string;
}

const POLL_WHILE_PENDING_MS = 2000;

const actionError = (error: Error | null) =>
  error &&
  (error instanceof ReviewApiError && error.status < 500
    ? error.message
    : "Could not complete this action. Please retry.");

export function ShareControl() {
  const context = useContext(SharingContext);
  const session = useOptionalReviewSession();
  const queryClient = useQueryClient();
  const client = context?.client;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ShareTarget>();
  const [copyError, setCopyError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const popover = useRef<HTMLDivElement>(null);
  const popoverRef = useTopbarPopover(open, popover);
  const shared = context?.reviewId.startsWith("shared-");
  const accountKey = canvasQueryKeys.sharingAccount();

  // Read while the review is open, refreshed on focus, polled while pending.
  const accountQuery = useQuery({
    queryKey: accountKey,
    queryFn: client
      ? ({ signal }) => client.read<SharingAccount>("/sharing/account", signal)
      : skipToken,
    enabled: !shared,
    refetchInterval: (query) =>
      query.state.data?.pending ? POLL_WHILE_PENDING_MS : false,
    // Sign-in finishes in the browser, while this window is in the background.
    refetchIntervalInBackground: true,
  });

  const { refetch: refetchAccount } = accountQuery;
  const account = accountQuery.data;
  const signedIn = Boolean(account?.account);

  const label = shared
    ? `Shared${context?.sender ? ` by ${context.sender}` : " review"}`
    : "Share review";

  const tooltip = useTooltip(label);

  // The library's focus refresh follows visibility; this follows window focus.
  useEffect(() => {
    if (!client || shared) return;
    const refresh = () => void refetchAccount();

    window.addEventListener("focus", refresh);

    return () => window.removeEventListener("focus", refresh);
  }, [client, shared, refetchAccount]);

  // Links created this canvas, so reopening a shared version skips the upload.
  const link = useQuery<string>({
    queryKey: canvasQueryKeys.shareLink(target?.version),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;

  const login = useMutation({
    mutationFn: () => client!.post("/sharing/login", {}),
    onSuccess: async () => {
      // An older read must not end the wait this login starts.
      await queryClient.cancelQueries({ queryKey: accountKey });
      queryClient.setQueryData<SharingAccount>(accountKey, {
        account: null,
        pending: true,
      });
    },
  });

  const publish = useMutation({
    mutationFn: ({ version, requestId }: ShareTarget) =>
      context!.client.post<{ url: string }>("/sharing/publish", {
        reviewId: context!.reviewId,
        version,
        requestId,
      }),
    onSuccess: ({ url }, { version }) =>
      queryClient.setQueryData(canvasQueryKeys.shareLink(version), url),
    onError: (error) => {
      // The host forgot a stale login; show sign-in and upload again after it.
      if (error instanceof ReviewApiError && error.status === 401)
        void queryClient.invalidateQueries({ queryKey: accountKey });
    },
  });

  const upload = (next: ShareTarget) => {
    login.reset();
    publish.mutate(next, {
      onError: (error) => {
        if (!(error instanceof ReviewApiError)) return;

        // Failed verification revokes the staged share; retry as a new one.
        if (error.status === 422)
          setTarget((current) =>
            current?.requestId === next.requestId
              ? { ...current, requestId: crypto.randomUUID() }
              : current,
          );
      },
    });
  };

  useDismissOnOutside(popover, open, setOpen);

  // Upload once per opening; a failure waits for Retry or a new sign-in.
  useEffect(() => {
    if (open && signedIn && target && publish.isIdle && !link) upload(target);
  }, [open, signedIn, target, publish.isIdle, link]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);

    return () => clearTimeout(timer);
  }, [copied]);

  if (!context) return null;

  const error = copyError ?? actionError(publish.error ?? login.error);

  const accountError = accountQuery.isError
    ? "Could not read sign-in status."
    : undefined;

  const copy = async (url: string) => {
    if (!(await copyText(url))) {
      setCopyError("Copy the link below.");

      return;
    }

    setCopied(true);

    if (session) captureUiEvent(session, "review_shared");
  };

  return (
    <div ref={popover} style={{ position: "relative" }}>
      <button
        type="button"
        className="review-topbar-icon-button review-share-button"
        ref={tooltip}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          // An upload of this version in flight keeps its request.
          if (
            !open &&
            !(publish.isPending && target?.version === context.version)
          ) {
            setTarget({
              version: context.version,
              requestId: crypto.randomUUID(),
            });
            publish.reset();
            login.reset();
            setCopyError(undefined);
            setCopied(false);
          }

          setOpen(!open);
        }}
      >
        <ShareIcon />
      </button>
      {open && (
        <div
          ref={popoverRef}
          popover="manual"
          role="dialog"
          aria-label={shared ? "Shared review" : "Share review"}
          className="review-share-popover"
        >
          {(error || accountError || account?.error) && (
            <p className="review-share-error" role="alert">
              {error ?? accountError ?? account?.error}
            </p>
          )}
          {shared ? (
            <>
              <p className="review-share-status">{label}</p>
              <p className="review-share-status">
                This is a read-only snapshot. Source files and traces are
                available offline.
              </p>
            </>
          ) : signedIn ? (
            link ? (
              <>
                <input
                  className="review-share-link"
                  aria-label="Share link"
                  readOnly
                  value={link}
                  onFocus={(event) => event.target.select()}
                />
                <button
                  type="button"
                  className="review-share-action"
                  onClick={() => void copy(link)}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              </>
            ) : error ? (
              <button
                type="button"
                className="review-share-action"
                onClick={() => target && upload(target)}
              >
                Retry
              </button>
            ) : (
              <p className="review-share-status">Uploading…</p>
            )
          ) : (
            account && (
              <>
                <button
                  type="button"
                  className="review-share-action"
                  disabled={
                    account.pending || login.isPending || publish.isPending
                  }
                  onClick={() => {
                    publish.reset();
                    login.mutate();
                  }}
                >
                  {account.pending
                    ? "Waiting for sign-in…"
                    : "Sign in to share"}
                </button>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
