import { layer, space } from "@canvas/scale.stylex";
import { Button, IconButton } from "@canvas/ui/button";
import { useCopy } from "@canvas/ui/copy";
import { iconStyles } from "@canvas/ui/icon-styles";
import { ShareIcon } from "@canvas/ui/icons";
import { Popover } from "@canvas/ui/popover";
import { textStyles } from "@canvas/ui/text";
import { TextField } from "@canvas/ui/text-field";
import { useTooltip } from "@canvas/ui/tooltip";
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
import { useOptionalReviewSession } from "./host/review-session";
import { topbarActionsMarker } from "./markers.stylex";
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

interface SharingAccount {
  account: { login: string; origin: string } | null;
  pending: boolean;
  userCode?: string;
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
  const control = useRef<HTMLDivElement>(null);
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
    queryKey: canvasQueryKeys.shareLink(
      context?.reviewId ?? "",
      target?.version,
    ),
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
      queryClient.setQueryData(
        canvasQueryKeys.shareLink(context!.reviewId, version),
        url,
      ),
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
      setCopyError(undefined);
    }

    setOpen(!open);
  };

  useImperativeHandle(handle, () => ({
    open: () => {
      if (!open) toggle();
    },
  }));

  // Upload once per opening; a failure waits for Retry or a new sign-in.
  useEffect(() => {
    if (open && signedIn && target && publish.isIdle && !link) upload(target);
  }, [open, signedIn, target, publish.isIdle, link]);

  if (!context) return null;

  const error = copyError ?? actionError(publish.error ?? login.error);

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
          aria-label={shared ? "Shared review" : "Share review"}
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
          {shared ? (
            <>
              <p {...stylex.props(styles.paragraph, styles.status)}>{label}</p>
              <p {...stylex.props(styles.paragraph, styles.status)}>
                This is a read-only snapshot, available offline.
              </p>
            </>
          ) : signedIn ? (
            link ? (
              <>
                <TextField
                  xstyle={styles.link}
                  aria-label="Share link"
                  readOnly
                  value={link}
                  onFocus={(event) => event.target.select()}
                />
                <Button variant="primary" onClick={() => copy(link)}>
                  {copied === link ? "Copied" : "Copy link"}
                </Button>
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
  code: {
    color: tokens.chromeFg,
    fontFamily: tokens.fontMono,
    fontWeight: tokens.chromeFontWeightStrong,
  },
});
