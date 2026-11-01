import { layer, space } from "@canvas/scale.stylex";
import { Button, IconButton, buttonStyles } from "@canvas/ui/button";
import { useCopy } from "@canvas/ui/copy";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import { ShareIcon } from "@canvas/ui/icons";
import { listRowStyles } from "@canvas/ui/list-row";
import { Popover } from "@canvas/ui/popover";
import { textStyles } from "@canvas/ui/text";
import { TextField } from "@canvas/ui/text-field";
import { useTooltip } from "@canvas/ui/tooltip";
import type { ShareRevisions } from "@dev.fast/review-share-protocol";
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
import {
  type Ref,
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { canvasQueryKeys } from "./canvas-query";
import { formatBytes, formatRelativeTime } from "./format";
import { useOptionalReviewSession } from "./host/review-session";
import { topbarActionsMarker } from "./markers.stylex";
import { useSharingAccount, useSignIn } from "./sharing-account";
import { shellStyles } from "./shell-styles";
import { tokens } from "./tokens.stylex";
import { captureUiEvent } from "./ui-telemetry";

export const SharingContext = createContext<{
  client: ReviewApiClient;
  reviewId: string;
  version: number;
  sender?: string;
  cloneUrl?: string;
} | null>(null);

/** The version a popover shares, frozen when it opens, and the idempotency
 * key the host deduplicates its upload by. */
interface ShareTarget {
  version: number;
  requestId: string;
}

interface SharedLink {
  shareId: string;
  url: string;
  version: number;
}

const actionError = (error: Error | null) =>
  error &&
  (error instanceof ReviewApiError && error.status < 500
    ? error.message
    : "Could not complete this action. Please retry.");

// Keeps focus in the popover when the control that had it goes away.
const focusOnMount = (element: HTMLElement | null) => element?.focus();

/** Whether this review can be shared, so a menu may offer Share. */
export function useCanShare(): boolean {
  return useContext(SharingContext) !== null;
}

export function ShareControl({
  folded = false,
  handle,
}: {
  /** In "⋯": no button, and the popover hangs from the bar's right end. */
  folded?: boolean;
  handle?: Ref<{ open(): void }>;
} = {}) {
  const context = useContext(SharingContext);
  const session = useOptionalReviewSession();
  const queryClient = useQueryClient();
  const client = context?.client;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ShareTarget>();
  const [copyError, setCopyError] = useState<string>();
  const [revoked, setRevoked] = useState(false);
  const control = useRef<HTMLDivElement>(null);
  const accountKey = canvasQueryKeys.sharingAccount();

  const accountQuery = useSharingAccount(client);
  const login = useSignIn(client);
  const account = accountQuery.data;
  const signedIn = Boolean(account?.account);

  const label = "Share review";
  const tooltip = useTooltip(label);

  // The board's one link; a new version uploads behind the same URL.
  const linkKey = canvasQueryKeys.shareLink(context?.reviewId ?? "");

  const link = useQuery<SharedLink>({
    queryKey: linkKey,
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;

  const [copied, copy] = useCopy({
    onCopied: () => {
      if (session) captureUiEvent(session, "review_shared");
    },
    onFailed: () => setCopyError("Copy the link below."),
  });

  const publish = useMutation({
    mutationFn: ({ version, requestId }: ShareTarget) =>
      context!.client.post<SharedLink>("/sharing/publish", {
        reviewId: context!.reviewId,
        version,
        requestId,
      }),
    // An older version's upload can land after a newer one's.
    onSuccess: (shared) => {
      queryClient.setQueryData<SharedLink>(linkKey, (cached) =>
        cached && cached.version > shared.version ? cached : shared,
      );
      void queryClient.invalidateQueries({
        queryKey: canvasQueryKeys.shareHistory(shared.shareId),
      });
    },
    onError: (error) => {
      // The host forgot a stale login; show sign-in and upload again after it.
      if (error instanceof ReviewApiError && error.status === 401)
        void queryClient.invalidateQueries({ queryKey: accountKey });
    },
  });

  const openRevision = useMutation({
    mutationFn: (url: string) =>
      context!.client.post<{ opened: true }>("/sharing/open", { url }),
  });

  const revoke = useMutation({
    mutationFn: (shareId: string) =>
      context!.client.post("/sharing/revoke", { shareId }),
    onSuccess: (_, shareId) => {
      queryClient.removeQueries({ queryKey: linkKey });
      queryClient.removeQueries({
        queryKey: canvasQueryKeys.shareHistory(shareId),
      });
      setRevoked(true);
    },
  });

  const confirm = session?.bridge.confirm;

  const revokeLink = async (shareId: string) => {
    if (!confirm || revoke.isPending) return;

    const confirmed = await confirm({
      message: "Revoke this share link?",
      detail:
        "Anyone with the link loses access to every version shared behind it.",
      primaryButton: "Revoke",
    });

    // The host's dialog can dismiss the popover; bring it back.
    setOpen(true);

    if (confirmed) revoke.mutate(shareId);
  };

  const upload = (next: ShareTarget) => {
    login.reset();
    publish.mutate(next);
  };

  const toggle = () => {
    if (!context) return;

    // An upload of this version in flight keeps its request.
    if (!open && !(publish.isPending && target?.version === context.version)) {
      setTarget({
        version: context.version,
        requestId: crypto.randomUUID(),
      });
      publish.reset();
      login.reset();
      openRevision.reset();
      revoke.reset();
      setRevoked(false);
      setCopyError(undefined);
    }

    // The read warms the host's connection to the share service.
    if (!open) void accountQuery.refetch();

    setOpen(!open);
  };

  useImperativeHandle(handle, () => ({
    open: () => {
      if (!open) toggle();
    },
  }));

  const current =
    link && target && link.version >= target.version ? link : undefined;

  const historyQuery = useQuery({
    queryKey: canvasQueryKeys.shareHistory(current?.shareId ?? ""),
    queryFn:
      open && current
        ? ({ signal }) =>
            context!.client.read<ShareRevisions>(
              `/sharing/history/${current.shareId}`,
              signal,
            )
        : skipToken,
  });

  const history = historyQuery.data;

  // Upload once per opening; a failure waits for Retry or a new sign-in.
  useEffect(() => {
    if (open && signedIn && target && publish.isIdle && !current && !revoked)
      upload(target);
  }, [open, signedIn, target, publish.isIdle, current, revoked]);

  if (!context) return null;

  const error =
    copyError ??
    actionError(
      publish.error ??
        login.error ??
        openRevision.error ??
        revoke.error ??
        historyQuery.error,
    );

  const accountError = accountQuery.isError
    ? "Could not read sign-in status."
    : undefined;

  return (
    <div
      ref={control}
      data-page-bar-fold={folded ? undefined : "share"}
      {...stylex.props(shellStyles.topbarItem, folded && styles.folded)}
      style={folded ? undefined : { position: "relative" }}
    >
      {folded ? null : (
        <IconButton
          ref={tooltip}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        >
          <ShareIcon xstyle={iconStyles.chrome} />
        </IconButton>
      )}
      {open && (
        <Popover
          anchor={control}
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label={label}
          xstyle={[shellStyles.topbarPopover, styles.popover]}
        >
          {(error || accountError || account?.error) && (
            <p
              {...stylex.props(styles.paragraph, textStyles.error)}
              role="alert"
            >
              {error ?? accountError ?? account?.error}
            </p>
          )}
          {context.sender && (
            <p {...stylex.props(styles.paragraph, styles.status)}>
              Shared by {context.sender}
            </p>
          )}
          {signedIn ? (
            revoked ? (
              <p
                ref={focusOnMount}
                role="status"
                tabIndex={-1}
                {...stylex.props(styles.paragraph, styles.notice)}
              >
                Link revoked. Sharing this board again creates a new link.
              </p>
            ) : current ? (
              <>
                <TextField
                  xstyle={styles.link}
                  aria-label="Share link"
                  readOnly
                  value={current.url}
                  onFocus={(event) => event.target.select()}
                />
                <p {...stylex.props(styles.paragraph, styles.status)}>
                  This link always opens the latest share of this board.
                </p>
                <Button variant="primary" onClick={() => copy(current.url)}>
                  {copied === current.url ? "Copied" : "Copy link"}
                </Button>
                {history && history.items.length > 0 && (
                  <ul
                    aria-label="Share history"
                    {...stylex.props(styles.history)}
                  >
                    {history.items.map((revision) => (
                      <li key={revision.id}>
                        <button
                          type="button"
                          data-share-revision=""
                          {...stylex.props(
                            focusStyles.ringInset,
                            buttonStyles.reset,
                            listRowStyles.row,
                            listRowStyles.wash,
                          )}
                          onClick={() => openRevision.mutate(revision.url)}
                        >
                          {`${formatRelativeTime(revision.createdAt)} · v${revision.version} · ${formatBytes(revision.size)}${revision.id === history.latest ? " · Latest" : ""}`}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {confirm && (
                  <Button
                    variant="ghost"
                    onClick={() => void revokeLink(current.shareId)}
                  >
                    Revoke link
                  </Button>
                )}
              </>
            ) : error ? (
              <Button
                variant="primary"
                onClick={() => target && upload(target)}
              >
                Retry
              </Button>
            ) : (
              <p {...stylex.props(styles.paragraph, styles.status)}>
                Uploading…
              </p>
            )
          ) : (
            account && (
              <>
                {account.userCode && (
                  <p {...stylex.props(styles.paragraph, styles.status)}>
                    Confirm code{" "}
                    <code {...stylex.props(styles.code)}>
                      {account.userCode}
                    </code>{" "}
                    in your browser.
                  </p>
                )}
                <Button
                  variant="primary"
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
                </Button>
              </>
            )
          )}
        </Popover>
      )}
    </div>
  );
}

const inTopbarActions = () =>
  stylex.when.ancestor(":is(*)", topbarActionsMarker);

const styles = stylex.create({
  // Out of the row, at its right end, so the popover still has an anchor.
  folded: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 0,
    height: "100%",
  },
  // Hovered, the open button keeps the topbar button hover colors.
  // In the topbar action row the shared anchoring (shellStyles.topbarPopover)
  // places it; these are its own values anywhere else.
  popover: {
    position: { default: "absolute", [inTopbarActions()]: "fixed" },
    zIndex: layer.popover,
    top: {
      default: "calc(100% + 4px)",
      [inTopbarActions()]: "calc(anchor(bottom) + 4px)",
    },
    right: { default: 0, [inTopbarActions()]: "anchor(right)" },
    display: "flex",
    flexDirection: "column",
    gap: space.s8,
    width: "280px",
    margin: 0,
    padding: `${space.s10} ${space.s12}`,
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
  link: {
    width: "100%",
  },
  notice: {
    outline: "none",
  },
  history: {
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  code: {
    color: tokens.chromeFg,
    fontFamily: tokens.fontMono,
    fontWeight: tokens.chromeFontWeightStrong,
  },
});
