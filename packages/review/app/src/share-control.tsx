import {
  type ReviewApiClient,
  ReviewApiError,
} from "@review/review-api/client";
import * as stylex from "@stylexjs/stylex";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { canvasQueryKeys } from "./canvas-query";
import { controlStyles } from "./controls-styles";
import { copyText } from "./copy-text";
import { useOptionalReviewSession } from "./host/review-session";
import { ShareIcon } from "./icons";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";
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
    <div
      ref={popover}
      {...stylex.props(shellStyles.topbarItem)}
      style={{ position: "relative" }}
    >
      <button
        type="button"
        {...stylex.props(shellStyles.topbarIconButton, open && styles.expanded)}
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
        <ShareIcon xstyle={controlStyles.chromeIcon} />
      </button>
      {open && (
        <div
          ref={popoverRef}
          popover="manual"
          role="dialog"
          aria-label={shared ? "Shared review" : "Share review"}
          {...stylex.props(shellStyles.topbarPopover, styles.popover)}
        >
          {(error || accountError || account?.error) && (
            <p {...stylex.props(styles.paragraph, styles.error)} role="alert">
              {error ?? accountError ?? account?.error}
            </p>
          )}
          {shared ? (
            <>
              <p {...stylex.props(styles.paragraph, styles.status)}>{label}</p>
              <p {...stylex.props(styles.paragraph, styles.status)}>
                This is a read-only snapshot. Source files and traces are
                available offline.
              </p>
            </>
          ) : signedIn ? (
            link ? (
              <>
                <input
                  {...stylex.props(styles.link)}
                  aria-label="Share link"
                  readOnly
                  value={link}
                  onFocus={(event) => event.target.select()}
                />
                <button
                  type="button"
                  {...stylex.props(styles.action)}
                  onClick={() => void copy(link)}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              </>
            ) : error ? (
              <button
                type="button"
                {...stylex.props(styles.action)}
                onClick={() => target && upload(target)}
              >
                Retry
              </button>
            ) : (
              <p {...stylex.props(styles.paragraph, styles.status)}>
                Uploading…
              </p>
            )
          ) : (
            account && (
              <>
                <button
                  type="button"
                  {...stylex.props(styles.action)}
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

const styles = stylex.create({
  // Hovered, the open button keeps the topbar button hover colors.
  expanded: {
    backgroundColor: {
      default: tokens.chromeHoverBg,
      ":hover": tokens.well,
    },
    color: { default: tokens.chromeFg, ":hover": tokens.ink },
  },
  popover: {
    position: "absolute",
    zIndex: 30,
    top: "calc(100% + 4px)",
    right: 0,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    width: "280px",
    margin: 0,
    padding: "10px 12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: "8px",
    backgroundColor: tokens.surfaceRaised,
    boxShadow: "0 8px 28px var(--shadow-color-strong)",
    color: tokens.chromeFg,
    fontFamily: tokens.chromeFont,
    fontSize: tokens.chromeFontSize,
  },
  paragraph: {
    margin: 0,
  },
  status: {
    color: tokens.chromeFgMuted,
  },
  error: {
    color: "var(--vscode-errorForeground, #f48771)",
  },
  link: {
    width: "100%",
    boxSizing: "border-box",
    height: "26px",
    padding: "0 8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.ruleSoft,
      ":focus-visible": tokens.chromeActiveBorder,
    },
    borderRadius: tokens.chromeControlRadius,
    backgroundColor: tokens.surface,
    color: tokens.ink,
    font: "inherit",
    outline: { default: null, ":focus-visible": "none" },
  },
  action: {
    height: "26px",
    padding: "0 12px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: tokens.chromeControlRadius,
    backgroundColor: tokens.accent,
    color: tokens.onAccent,
    font: "inherit",
    cursor: { default: "pointer", ":disabled": "default" },
    filter: {
      default: null,
      ":hover:not(:disabled)": "brightness(1.1)",
      ":focus-visible:not(:disabled)": "brightness(1.1)",
    },
    outline: {
      default: null,
      ":hover:not(:disabled)": "none",
      ":focus-visible:not(:disabled)": "none",
    },
    opacity: { default: null, ":disabled": 0.6 },
  },
});
