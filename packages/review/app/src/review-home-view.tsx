import { documentType } from "@canvas/document-type.stylex";
import {
  fontSize,
  fontWeight,
  motion,
  radius,
  tracking,
} from "@canvas/scale.stylex";
import { Button, IconButton, buttonStyles } from "@canvas/ui/button";
import { EmptyState } from "@canvas/ui/empty-state";
import { textStyles } from "@canvas/ui/text";
import type {
  ReviewApiSummary,
  ReviewCanvasInstallContent,
  ReviewCanvasOnboarding,
  ReviewCanvasSetupActions,
  ReviewGatewayHostState,
} from "@dev.fast/review-protocol";
import { fuzzyMatches, fuzzySegments } from "@review/fuzzy-match";
import * as stylex from "@stylexjs/stylex";
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { homeStyles } from "./home-styles";
import { CanvasUiContext, useCanvasMenu } from "./host/canvas-ui";
import { OptionMenu } from "./option-menu";
import { ArchiveIcon } from "./review-corner-action";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { WelcomePage } from "./welcome-page";

interface ReviewHomeProps {
  reviews: readonly ReviewApiSummary[];
  onOpen(review: ReviewApiSummary): void;
  // Deletion requires host confirmation.
  // Absent when the host does not support deletion.
  onDelete?(review: ReviewApiSummary): Promise<void>;
  // Dismissal is reversible. Absent when the host does not
  // support them.
  onDismiss?(review: ReviewApiSummary): Promise<void>;
  onRestore?(review: ReviewApiSummary): Promise<void>;
  hostStates?(): Promise<readonly ReviewGatewayHostState[]>;
  // Present only while the list is empty: Home then renders Welcome.
  install?: ReviewCanvasInstallContent;
  setupActions?: ReviewCanvasSetupActions;
  onboarding?: ReviewCanvasOnboarding;
  onOpenTutorial?(): void;
}

interface ReviewAttentionActions {
  onDelete?(review: ReviewApiSummary): Promise<void>;
  onDismiss?(review: ReviewApiSummary): Promise<void>;
  onRestore?(review: ReviewApiSummary): Promise<void>;
}

/* Passed by context rather than through every list and card signature: the
   actions are optional and only leaf controls use them. */
const AttentionActionsContext = createContext<ReviewAttentionActions>({});

/* The search query reaches the leaves the same way, and for the same reason:
   every title and worktree label marks its own hit, and threading a prop
   through the card tree and a table column would touch far more code. */
const SearchQueryContext = createContext("");

/** A label with the characters the query hit marked. */
function MatchedText({ text }: { text: string }) {
  const query = useContext(SearchQueryContext);
  const segments = fuzzySegments(query, text);

  // One segment can also mean the query matched the whole label, so check that
  // it is the unmatched one before skipping the marks.
  if (segments.length === 1 && !segments[0].matched) return <>{text}</>;

  return (
    <>
      {segments.map((segment, index) =>
        segment.matched ? (
          // Segments are positional, so the index is the only stable key.
          // eslint-disable-next-line react/no-array-index-key
          <mark key={index} {...stylex.props(styles.mark)}>
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

export function ReviewHome({
  reviews,
  onOpen,
  onDelete,
  onDismiss,
  onRestore,
  hostStates,
  install,
  setupActions,
  onboarding,
  onOpenTutorial,
}: ReviewHomeProps) {
  const ui = useContext(CanvasUiContext);
  const deleting = useRef(new Set<string>());
  const [showDismissed, setShowDismissed] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [query, setQuery] = useState("");
  const [, setNow] = useState(Date.now);

  const [deletions, setDeletions] = useState(
    new Map<string, "pending" | "deleted">(),
  );

  const [deleteError, setDeleteError] = useState<string>();
  const [hostMessage, setHostMessage] = useState<string>();
  const hostMessageGeneration = useRef(0);

  useEffect(() => {
    hostMessageGeneration.current++;
    setHostMessage(undefined);
  }, [reviews]);

  const open = useCallback(
    async (review: ReviewApiSummary) => {
      const generation = ++hostMessageGeneration.current;

      if (!unavailable(review)) {
        setHostMessage(undefined);
        onOpen(review);

        return;
      }

      setHostMessage(`${review.host} is ${hostStateWords(review)}.`);
      const states = await hostStates?.().catch(() => undefined);
      const detail = states?.find((host) => host.alias === review.host)?.detail;

      if (detail && generation === hostMessageGeneration.current)
        setHostMessage(detail);
    },
    [onOpen, hostStates],
  );

  // Keep successful deletions hidden until the catalog acknowledges removal.
  useEffect(() => {
    setDeletions((current) => {
      const next = new Map(current);

      for (const [id, status] of current) {
        if (
          status === "deleted" &&
          !reviews.some((review) => review.reviewId === id)
        ) {
          next.delete(id);
        }
      }

      return next.size === current.size ? current : next;
    });
  }, [reviews, deletions]);

  const deleteReview = useCallback(
    async (review: ReviewApiSummary) => {
      if (
        !onDelete ||
        !ui?.confirmDelete ||
        deleting.current.has(review.reviewId)
      )
        return;
      deleting.current.add(review.reviewId);
      setDeleteError(undefined);

      try {
        if (!(await ui.confirmDelete(reviewTitle(review)))) return;
        setDeletions((current) =>
          new Map(current).set(review.reviewId, "pending"),
        );
        await onDelete(review);
        setDeletions((current) =>
          new Map(current).set(review.reviewId, "deleted"),
        );
      } catch {
        setDeletions((current) => {
          const next = new Map(current);
          next.delete(review.reviewId);

          return next;
        });
        setDeleteError(
          `Could not delete “${reviewTitle(review)}”. Please try again.`,
        );
      } finally {
        deleting.current.delete(review.reviewId);
      }
    },
    [onDelete, ui],
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);

  const actions = useMemo(
    () => ({
      onDismiss,
      onRestore,
      onDelete: onDelete ? deleteReview : undefined,
    }),
    [onDismiss, onRestore, onDelete, deleteReview],
  );

  const needle = query.trim();

  // The one scratchpad is the last group on Home, outside the workspaces,
  // their chronological order and their lifecycle. The filter still finds it.
  const scratchpad = reviews.find((review) => review.kind === "scratchpad");

  const listed = useMemo(
    () => reviews.filter((review) => review.kind !== "scratchpad"),
    [reviews],
  );

  const scratchpadShown =
    scratchpad !== undefined && matchesQuery(scratchpad, needle);

  const found = useMemo(
    () =>
      listed.filter(
        (review) =>
          !deletions.has(review.reviewId) && matchesQuery(review, needle),
      ),
    [listed, needle, deletions],
  );

  /* Dismissed leaves the main list entirely: it is the one group you asked to
     stop seeing. */
  const active = found.filter((review) => !review.dismissedAt);

  const dismissed = found
    .filter((review) => review.dismissedAt)
    .sort(latestFirst);

  /* With nothing to list, Home is the Welcome rail rather than a zero state
     of its own: the same three steps, in the place the reader already is.
 */
  if (
    !onboardingDismissed &&
    listed.length === 0 &&
    deletions.size === 0 &&
    !deleteError
  ) {
    return (
      <WelcomePage
        onDismissUpdate={() => setOnboardingDismissed(true)}
        install={install}
        setupActions={setupActions}
        onboarding={onboarding}
        onOpenTutorial={onOpenTutorial}
      />
    );
  }

  return (
    <main {...withClass("review-home", homeStyles.page)}>
      <div {...stylex.props(homeStyles.scroll)}>
        <div {...stylex.props(homeStyles.content)}>
          <div {...stylex.props(homeStyles.header)}>
            <h1 {...stylex.props(homeStyles.heading)}>Sessions</h1>
            <div {...stylex.props(styles.headerTools)}>
              <SearchBox query={query} onChange={setQuery} />
            </div>
          </div>
          {deleteError ? <p role="alert">{deleteError}</p> : null}
          {hostMessage ? <p role="alert">{hostMessage}</p> : null}
          {/* Keyed off the active list, not the whole result: a query that hits
              only dismissed reviews empties the main area, and the collapsed
              Dismissed count alone does not explain why. */}
          {needle && active.length === 0 && !scratchpadShown ? (
            <EmptyState
              message={
                dismissed.length > 0
                  ? `No active reviews match “${needle}”. Look in Dismissed below.`
                  : `No reviews match “${needle}”.`
              }
            />
          ) : null}
          <SearchQueryContext.Provider value={needle}>
            <AttentionActionsContext.Provider value={actions}>
              {scratchpadShown ? (
                <ScratchpadGroup review={scratchpad} onOpen={onOpen} />
              ) : null}
              {active.length > 0 ? (
                <ReviewTable reviews={active} onOpen={open} />
              ) : null}
              {dismissed.length > 0 ? (
                <DismissedSection
                  reviews={dismissed}
                  expanded={showDismissed}
                  onToggle={() => setShowDismissed((shown) => !shown)}
                  onOpen={open}
                  onDelete={actions.onDelete}
                />
              ) : null}
            </AttentionActionsContext.Provider>
          </SearchQueryContext.Provider>
        </div>
      </div>
    </main>
  );
}

/**
 * Filter-as-you-type over the review title and the worktree name — the two
 * labels the page already shows. Escape clears it.
 */
function SearchBox({
  query,
  onChange,
}: {
  query: string;
  onChange(query: string): void;
}) {
  const input = useRef<HTMLInputElement>(null);

  // ⌘F (Ctrl+F off the Mac) jumps to the filter instead of the browser's
  // find bar. Ctrl+F stays forward-char on the Mac.
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);

    const keydown = (event: KeyboardEvent) => {
      if (
        (mac ? event.metaKey : event.ctrlKey) &&
        !(mac ? event.ctrlKey : event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };

    window.addEventListener("keydown", keydown);

    return () => window.removeEventListener("keydown", keydown);
  }, []);

  return (
    <div {...stylex.props(styles.search)}>
      <SearchIcon />
      <input
        ref={input}
        {...stylex.props(styles.searchInput)}
        type="search"
        value={query}
        placeholder="Search sessions"
        aria-label="Search sessions"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.stopPropagation();
            onChange("");
          }
        }}
      />
      {query ? (
        <button
          type="button"
          {...stylex.props(styles.searchClear)}
          aria-label="Clear search"
          // Clearing unmounts this button, so hand focus back to the field
          // rather than letting it fall to the body.
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
        >
          <ClearIcon />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Dismissed reviews, collapsed by default and kept out of the workspace
 * grouping. Sessions stay saved until the reader deletes them.
 */
function DismissedSection({
  reviews,
  expanded,
  onToggle,
  onOpen,
  onDelete,
}: {
  reviews: readonly ReviewApiSummary[];
  expanded: boolean;
  onToggle(): void;
  onOpen(review: ReviewApiSummary): void;
  onDelete?(review: ReviewApiSummary): Promise<void>;
}) {
  return (
    <section
      {...stylex.props(styles.dismissed)}
      aria-label="Dismissed sessions"
    >
      <button
        type="button"
        {...stylex.props(textStyles.eyebrow, styles.dismissedToggle)}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span>Dismissed</span>
        <span {...stylex.props(styles.dismissedCount)}>{reviews.length}</span>
      </button>
      {expanded ? (
        <div {...stylex.props(styles.dismissedRows)}>
          {reviews.map((review) => (
            <div key={review.reviewId} {...stylex.props(styles.dismissedRow)}>
              <button
                type="button"
                {...stylex.props(styles.dismissedOpen)}
                onClick={() => onOpen(review)}
              >
                <MatchedText text={reviewTitle(review)} />
              </button>
              <span {...stylex.props(styles.dismissedClock)}>kept</span>
              <RestoreReviewButton review={review} />
              {onDelete ? (
                <DeleteReviewButton review={review} onDelete={onDelete} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** Undo clears the dismissal stamp. */
function RestoreReviewButton({ review }: { review: ReviewApiSummary }) {
  const { onRestore } = useContext(AttentionActionsContext);
  const [busy, setBusy] = useState(false);

  if (!onRestore) return null;

  return (
    <Button
      xstyle={styles.restore}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        void onRestore(review)
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      Undo
    </Button>
  );
}

type ReviewSort = "newest" | "oldest" | "updated" | "pr" | "title";

function ReviewTable({
  reviews,
  onOpen,
}: {
  reviews: readonly ReviewApiSummary[];
  onOpen(review: ReviewApiSummary): void;
}) {
  const [repository, setRepository] = useState("");
  const [sort, setSort] = useState<ReviewSort>("newest");

  const repositories = [
    ...new Map(
      reviews.map((review) => [repositoryKey(review), repositoryLabel(review)]),
    ),
  ].sort(([, left], [, right]) => left.localeCompare(right));

  const filtered = reviews.filter(
    (review) => !repository || repositoryKey(review) === repository,
  );

  const sorted = [...filtered].sort((left, right) => {
    const created = (review: ReviewApiSummary) =>
      Date.parse(review.firstCreatedAt ?? review.createdAt) || 0;

    switch (sort) {
      case "oldest":
        return created(left) - created(right);
      case "updated":
        return latestFirst(left, right);
      case "pr":
        return (
          (right.origin?.pullRequestNumber ?? -1) -
            (left.origin?.pullRequestNumber ?? -1) || latestFirst(left, right)
        );
      case "title":
        return reviewTitle(left).localeCompare(reviewTitle(right));
      default:
        return created(right) - created(left);
    }
  });

  return (
    <section {...stylex.props(styles.tableSection)} aria-label="Sessions">
      <div {...stylex.props(styles.toolbar)}>
        <span>{countLabel(filtered.length, "review")}</span>
        <div {...stylex.props(styles.controls)}>
          <TableMenu
            label="Filter"
            ariaLabel="Filter by repository"
            value={repository}
            options={[
              { value: "", label: "All repos" },
              ...repositories.map(([value, label]) => ({ value, label })),
            ]}
            onChange={setRepository}
          />
          <TableMenu<ReviewSort>
            label="Sort"
            ariaLabel="Sort reviews"
            value={sort}
            options={[
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
              { value: "updated", label: "Recently updated" },
              { value: "pr", label: "PR number" },
              { value: "title", label: "Title A–Z" },
            ]}
            onChange={setSort}
          />
        </div>
      </div>
      <div {...stylex.props(styles.tableScroll)}>
        <table {...stylex.props(styles.table)}>
          <colgroup>
            <col {...stylex.props(styles.colPr)} />
            <col />
            <col {...stylex.props(styles.colBranch)} />
            <col {...stylex.props(styles.colDate)} />
            <col {...stylex.props(styles.colDate)} />
            <col {...stylex.props(styles.colAction)} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" {...stylex.props(styles.th, styles.firstCell)}>
                PR
              </th>
              <th scope="col" {...stylex.props(styles.th)}>
                Title
              </th>
              <th scope="col" {...stylex.props(styles.th)}>
                Head branch
              </th>
              <th scope="col" {...stylex.props(styles.th)}>
                Created
              </th>
              <th scope="col" {...stylex.props(styles.th)}>
                Updated
              </th>
              <th scope="col" {...stylex.props(styles.th)}>
                <span {...stylex.props(styles.visuallyHidden)}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((review, index) => {
              const last = index === sorted.length - 1;

              return (
                <tr
                  key={review.reviewId}
                  {...stylex.props(
                    stylex.defaultMarker(),
                    styles.row,
                    unavailable(review) && styles.unavailableRow,
                  )}
                  data-unavailable={unavailable(review) ? "" : undefined}
                  onClick={() => onOpen(review)}
                >
                  <td
                    {...stylex.props(
                      styles.td,
                      styles.firstCell,
                      styles.strongCell,
                      last && styles.lastRowCell,
                    )}
                  >
                    {review.origin?.pullRequestNumber
                      ? `#${review.origin.pullRequestNumber}`
                      : "—"}
                  </td>
                  <td {...stylex.props(styles.td, last && styles.lastRowCell)}>
                    <button
                      {...stylex.props(styles.tableOpen)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(review);
                      }}
                      aria-disabled={unavailable(review) || undefined}
                      title={
                        unavailable(review)
                          ? `${review.host} is ${hostStateWords(review)}`
                          : reviewTitle(review)
                      }
                    >
                      <span {...stylex.props(styles.title, styles.tableTitle)}>
                        <MatchedText text={reviewTitle(review)} />
                      </span>
                      <span
                        {...stylex.props(styles.repository)}
                        title={
                          review.repositoryPath ??
                          (review.shared ? "Shared review" : undefined)
                        }
                      >
                        <RepositoryName review={review} />
                        {unavailable(review) ? (
                          <span {...stylex.props(styles.cardMetaNext)}>
                            {hostStateWords(review)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </td>
                  <td
                    {...stylex.props(styles.td, last && styles.lastRowCell)}
                    title={review.origin?.branch}
                  >
                    <MatchedText
                      text={readableSourceBranch(review.origin?.branch) ?? "—"}
                    />
                  </td>
                  <td
                    {...stylex.props(
                      styles.td,
                      styles.dateCell,
                      last && styles.lastRowCell,
                    )}
                    title={review.firstCreatedAt}
                  >
                    {formatCreatedTime(review.firstCreatedAt)}
                  </td>
                  <td
                    {...stylex.props(
                      styles.td,
                      styles.inkCell,
                      styles.dateCell,
                      last && styles.lastRowCell,
                    )}
                    title={reviewUpdatedAt(review)}
                  >
                    {formatRelativeTime(reviewUpdatedAt(review))}
                  </td>
                  <td {...stylex.props(styles.td, last && styles.lastRowCell)}>
                    <ReviewRowActions review={review} />
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 ? (
              <tr {...stylex.props(styles.row)}>
                <td
                  colSpan={6}
                  {...stylex.props(
                    styles.td,
                    styles.firstCell,
                    styles.strongCell,
                    styles.lastRowCell,
                  )}
                >
                  No reviews match this repository.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReviewRowActions({ review }: { review: ReviewApiSummary }) {
  const { onDelete } = useContext(AttentionActionsContext);
  const ui = useContext(CanvasUiContext);

  const menu = useCanvasMenu({
    items: [{ id: "delete", label: "Delete session" }],
    onSelect: () => onDelete?.(review),
  });

  if (!onDelete) return <DismissReviewButton review={review} />;

  return (
    <div
      {...stylex.props(styles.rowActions)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <IconButton
        size="large"
        xstyle={[rowMenuStyles.trigger, menu.open && rowMenuStyles.expanded]}
        aria-label={`Actions for ${reviewTitle(review)}`}
        {...menu.triggerProps}
        disabled={!ui?.confirmDelete}
      >
        <svg
          {...stylex.props(rowMenuStyles.icon)}
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <circle cx="4.5" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="15.5" cy="10" r="1.6" />
        </svg>
      </IconButton>
    </div>
  );
}

function TableMenu<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label: "Filter" | "Sort";
  ariaLabel: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}) {
  return (
    <OptionMenu
      ariaLabel={ariaLabel}
      value={value}
      options={options}
      onChange={onChange}
      triggerStyle={[
        buttonStyles.base,
        buttonStyles.secondary,
        buttonStyles.large,
        styles.menuTrigger,
      ]}
    >
      <svg
        {...stylex.props(styles.menuIcon)}
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path
          d={
            label === "Filter"
              ? "M3 5h14M6 10h8M8.5 15h3"
              : "M6 4v12m0 0-3-3m3 3 3-3M14 16V4m0 0-3 3m3-3 3 3"
          }
        />
      </svg>
      <span>{label}</span>
      <strong {...stylex.props(styles.menuValue)}>
        {options.find((option) => option.value === value)?.label ?? value}
      </strong>
    </OptionMenu>
  );
}

function formatCreatedTime(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";

  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * The scratchpad's own group, last on Home: a header in the workspace
 * header's grammar, then one card in the review card's grammar. No status,
 * workspace or dismissal, since it has none.
 */
function ScratchpadGroup({
  review,
  onOpen,
}: {
  review: ReviewApiSummary;
  onOpen(review: ReviewApiSummary): void;
}) {
  const contents = review.contents;

  return (
    <section {...stylex.props(styles.scratchpad)} aria-label="Scratchpad">
      <div {...stylex.props(styles.cards)}>
        <div {...stylex.props(styles.cardShell)}>
          <button
            type="button"
            {...stylex.props(styles.card)}
            onClick={() => onOpen(review)}
          >
            <span {...stylex.props(styles.cardMain)}>
              <span {...stylex.props(styles.title, styles.cardTitle)}>
                <PencilIcon />
                <MatchedText text={reviewTitle(review)} />
              </span>
              <span {...stylex.props(styles.cardMeta)}>
                {contents ? (
                  <>
                    <span>{countLabel(contents.blocks, "block")}</span>
                    <span {...stylex.props(styles.cardMetaNext)}>
                      {countLabel(contents.diagrams, "diagram")}
                    </span>
                  </>
                ) : null}
                <span {...stylex.props(contents && styles.cardMetaNext)}>
                  updated {formatRelativeTime(reviewUpdatedAt(review))}
                </span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}

function PencilIcon() {
  return (
    <svg
      {...stylex.props(styles.scratchpadGlyph)}
      aria-hidden="true"
      viewBox="0 0 16 16"
    >
      <path d="M3 13l1-4 7-7 3 3-7 7-4 1z" />
      <path d="M10 3l3 3" />
    </svg>
  );
}

/**
 * The one action an active review offers. One click: dismissal is reversible,
 * so it needs no arming step. It stays enabled for unavailable reviews so a
 * dead review can still leave the list.
 */
function DismissReviewButton({ review }: { review: ReviewApiSummary }) {
  const { onDismiss } = useContext(AttentionActionsContext);
  const [busy, setBusy] = useState(false);

  if (!onDismiss) return null;
  const title = reviewTitle(review);

  return (
    <IconButton
      size="small"
      xstyle={styles.dismiss}
      aria-label={`Dismiss ${title}`}
      title="Dismiss session"
      disabled={busy}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        void onDismiss(review)
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <ArchiveIcon xstyle={styles.dismissIcon} />
    </IconButton>
  );
}

function DeleteReviewButton({
  review,
  onDelete,
}: {
  review: ReviewApiSummary;
  onDelete(review: ReviewApiSummary): Promise<void>;
}) {
  const ui = useContext(CanvasUiContext);
  const [busy, setBusy] = useState(false);

  return (
    <IconButton
      size="small"
      xstyle={styles.delete}
      aria-label={`Delete ${reviewTitle(review)}`}
      title="Delete session"
      disabled={busy || !ui?.confirmDelete}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        void onDelete(review)
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <TrashIcon />
    </IconButton>
  );
}

function RepositoryName({ review }: { review: ReviewApiSummary }) {
  const label = repositoryLabel(review);
  const separator = label.lastIndexOf("/");

  return separator < 0 ? (
    <strong {...stylex.props(styles.repositoryName)}>
      <MatchedText text={label} />
    </strong>
  ) : (
    <>
      <span>
        <MatchedText text={label.slice(0, separator)} />
      </span>
      <span aria-hidden="true" {...stylex.props(styles.repositorySeparator)}>
        /
      </span>
      <strong {...stylex.props(styles.repositoryName)}>
        <MatchedText text={label.slice(separator + 1)} />
      </strong>
    </>
  );
}

export function reviewUpdatedAt(review: ReviewApiSummary): string {
  return review.createdAt;
}

/** {@link reviewUpdatedAt} as epoch milliseconds; 0 when unknown. */
function reviewUpdatedAtMs(review: ReviewApiSummary): number {
  return Date.parse(reviewUpdatedAt(review) ?? "") || 0;
}

function latestFirst(left: ReviewApiSummary, right: ReviewApiSummary): number {
  return reviewUpdatedAtMs(right) - reviewUpdatedAtMs(left);
}

export function formatRelativeTime(
  timestamp: string | null | undefined,
  now = Date.now(),
): string {
  if (!timestamp) return "unknown";
  const then = Date.parse(timestamp);

  if (!Number.isFinite(then)) return "unknown";
  const elapsed = Math.max(0, now - then);

  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);

  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);

  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(then);
}

function reviewTitle(review: ReviewApiSummary): string {
  return review.title.trim() || "Untitled session";
}

function matchesQuery(review: ReviewApiSummary, query: string): boolean {
  return fuzzyMatches(
    query,
    reviewTitle(review),
    repositoryLabel(review),
    review.repositoryPath ?? "",
    review.origin?.branch ?? "",
  );
}

function unavailable(review: ReviewApiSummary): boolean {
  return review.hostState !== undefined && review.hostState !== "online";
}

function hostStateWords(review: ReviewApiSummary): string {
  return review.hostState?.replace("-", " ") ?? "";
}

function repositoryKey(review: ReviewApiSummary): string {
  return review.repositoryGroup?.key ?? repositoryLabel(review);
}

function repositoryLabel(review: ReviewApiSummary): string {
  const label = localRepositoryLabel(review);

  return review.host ? `${review.host}: ${label}` : label;
}

function localRepositoryLabel(review: ReviewApiSummary): string {
  if (review.repositoryGroup) return review.repositoryGroup.label;

  if (review.shared?.cloneUrl) {
    try {
      return new URL(review.shared.cloneUrl).pathname
        .replace(/^\//, "")
        .replace(/\.git$/, "");
    } catch {
      // Older imports may not have a valid remote URL.
    }
  }

  return (
    review.repositoryName ??
    worktreeLabel(review.repositoryPath ?? review.pins?.repositoryId ?? "")
  );
}

function readableSourceBranch(value: string | null | undefined): string | null {
  if (!value || /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)) return null;

  return value;
}

function worktreeLabel(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);

  return parts.at(-1) ?? value;
}

export function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function SearchIcon() {
  return (
    <svg
      {...stylex.props(styles.searchIcon)}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle {...stylex.props(styles.searchStroke)} cx="7" cy="7" r="4.25" />
      <path {...stylex.props(styles.searchStroke)} d="M10.2 10.2 13.5 13.5" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      {...stylex.props(styles.clearIcon)}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        {...stylex.props(styles.searchStroke)}
        d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      {...stylex.props(styles.deleteIcon)}
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path
        {...stylex.props(styles.deleteStroke)}
        d="M3.5 5.5h13M8 5.5V4h4v1.5M5 5.5l.8 11h8.4l.8-11M8.3 8.5l.3 5M11.7 8.5l-.3 5"
      />
    </svg>
  );
}

const rowMenuStyles = stylex.create({
  // Waits for its row's hover or focus.
  trigger: {
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
    },
  },
  expanded: {
    opacity: 1,
  },
  icon: {
    width: "16px",
    height: "16px",
    fill: "currentColor",
  },
});

const narrow = "@container review-canvas (max-width: 660px)";

const styles = stylex.create({
  headerTools: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: "8px",
  },
  // Fixed width, so the clear button appearing does not resize the field.
  search: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    width: "256px",
    height: "38px",
    padding: "0 14px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: tokens.rule, ":focus-within": tokens.accent },
    borderRadius: radius.control,
    backgroundColor: tokens.surface,
    boxShadow: {
      default: null,
      ":focus-within": `0 0 0 3px ${tokens.markerTint}`,
    },
    color: { default: tokens.inkFaint, ":focus-within": tokens.inkMuted },
    fontSize: fontSize.reading,
    gap: "12px",
  },
  searchIcon: {
    width: "18px",
    height: "18px",
    flex: "0 0 auto",
  },
  searchStroke: {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeWidth: "1.5",
  },
  searchInput: {
    minWidth: 0,
    flex: 1,
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    color: tokens.ink,
    backgroundColor: tokens.transparent,
    font: "inherit",
    outline: "none",
    "::placeholder": {
      color: tokens.reviewHomeMeta,
    },
    // The user agent draws its own clear button in a colour the page cannot
    // reach, so the page draws its own.
    "::-webkit-search-cancel-button": {
      appearance: "none",
    },
    "::-webkit-search-decoration": {
      appearance: "none",
    },
  },
  searchClear: {
    display: "grid",
    width: "16px",
    height: "16px",
    flex: "0 0 auto",
    padding: 0,
    placeItems: "center",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: radius.small,
    color: { default: tokens.reviewHomeMeta, ":hover": tokens.ink },
    backgroundColor: tokens.transparent,
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "1px" },
  },
  clearIcon: {
    width: "11px",
    height: "11px",
    flex: "0 0 auto",
  },
  // The user agent paints <mark> black on yellow, which is unreadable on the
  // canvas. Carry the mark on the background and inherit the text colour: on
  // a dark theme, recolouring the glyphs to the accent makes the matched word
  // dimmer than the words around it, which is the opposite of a highlight.
  // Inherit the weight too, so marking a run does not reflow its line.
  mark: {
    padding: "0 1px",
    borderRadius: radius.small,
    backgroundColor: `color-mix(in srgb, ${tokens.accent} 30%, ${tokens.transparent})`,
    color: "inherit",
    fontWeight: "inherit",
  },

  // The scratchpad's group sits first, above the sessions table.
  scratchpad: {
    paddingTop: "14px",
    marginBottom: "16px",
  },
  cards: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 336px)",
    gridAutoRows: "1fr",
    gap: "18px",
    justifyContent: "start",
    marginTop: "24px",
  },
  cardShell: {
    position: "relative",
    minWidth: 0,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: "12px",
    width: "100%",
    minWidth: 0,
    height: "100%",
    minHeight: "128px",
    padding: "16px 16px 14px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.rule,
      ":focus-visible": tokens.accent,
      ":hover:not(:disabled)": tokens.ruleSoft,
    },
    borderRadius: radius.surface,
    color: "inherit",
    backgroundColor: tokens.surface,
    textAlign: "left",
    transition: `border-color ${motion.fast} ${motion.ease}, box-shadow ${motion.fast} ${motion.ease}`,
    boxShadow: {
      default: null,
      ":focus-visible": `0 0 0 3px ${tokens.markerTint}`,
    },
    outline: { default: null, ":focus-visible": "none" },
    cursor: { default: null, ":disabled": "not-allowed" },
    opacity: { default: null, ":disabled": 0.5 },
  },
  cardMain: {
    display: "flex",
    flexDirection: "column",
    gap: "7px",
    minWidth: 0,
  },
  title: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.ink,
    font: `${fontWeight.medium} ${documentType.body}/22px ${tokens.fontSerif}`,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    whiteSpace: "normal",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
  },
  tableTitle: {
    display: "block",
    width: "100%",
  },
  cardMeta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: "10px",
    rowGap: "3px",
    color: tokens.reviewHomeMeta,
    font: `${fontSize.small} ${tokens.fontMono}`,
  },
  // Meta lines are one sentence of facts joined by a middle dot.
  cardMetaNext: {
    "::before": {
      content: '"· "',
      color: tokens.inkFaint,
      whiteSpace: "pre",
    },
  },
  scratchpadGlyph: {
    width: "14px",
    height: "14px",
    fill: "none",
    stroke: tokens.inkFaint,
    strokeWidth: "1.2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },

  // Dismissed reviews sit below the active list, collapsed.
  dismissed: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    marginTop: "26px",
  },
  dismissedToggle: {
    display: "inline-flex",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: "8px",
    padding: "4px 0",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
  },
  dismissedCount: {
    fontWeight: fontWeight.medium,
    letterSpacing: 0,
  },
  dismissedRows: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  dismissedRow: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "10px 14px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.surface,
  },
  dismissedOpen: {
    overflow: "hidden",
    flex: "1 1 auto",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
    color: tokens.inkMuted,
    fontSize: fontSize.ui,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dismissedClock: {
    flex: "0 0 auto",
    color: tokens.inkMuted,
    font: `${fontWeight.regular} ${fontSize.small} ${tokens.fontMono}`,
    opacity: 0.75,
  },
  restore: {
    color: tokens.accent,
  },
  delete: {
    color: {
      default: tokens.chromeIconFg,
      ":hover:not(:disabled)": tokens.changeRemoved,
      ":focus-visible": tokens.changeRemoved,
    },
  },
  deleteIcon: {
    width: "13px",
    height: "13px",
  },
  deleteStroke: {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.2",
  },
  // In the table it waits for its row's hover or focus.
  dismiss: {
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
    },
  },
  dismissIcon: {
    width: "13px",
    height: "13px",
    fill: "none",
    stroke: "currentColor",
    strokeLinejoin: "round",
    strokeWidth: "1.2",
  },

  // Paper desktop table: fixed metadata lanes and a flexible title column.
  tableSection: {
    marginTop: "24px",
  },
  toolbar: {
    display: "flex",
    flexDirection: { default: null, [narrow]: "column" },
    alignItems: { default: "center", [narrow]: "flex-start" },
    justifyContent: "space-between",
    gap: "8px",
    padding: "8px 0 12px",
    marginBottom: "24px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    color: tokens.inkMuted,
    font: `${fontSize.reading}/24px ${tokens.fontMono}`,
  },
  controls: {
    display: "flex",
    flexWrap: { default: null, [narrow]: "wrap" },
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  // A secondary Button held down while its menu is open.
  menuTrigger: {
    borderColor: {
      default: tokens.rule,
      ':is([aria-expanded="true"])': tokens.inkFaint,
    },
    backgroundColor: {
      default: tokens.surface,
      ":hover": tokens.tray,
      ':is([aria-expanded="true"])': tokens.tray,
    },
    color: tokens.inkMuted,
  },
  menuValue: {
    color: tokens.ink,
    fontWeight: fontWeight.medium,
  },
  menuIcon: {
    width: "14px",
    height: "14px",
    flexShrink: 0,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  tableScroll: {
    overflowX: "auto",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
  },
  table: {
    width: "100%",
    minWidth: "840px",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    font: `${fontSize.body}/18px ${tokens.fontMono}`,
  },
  colPr: {
    width: "88px",
  },
  colBranch: {
    width: {
      default: "296px",
      "@container review-canvas (max-width: 1100px)": "200px",
    },
  },
  colDate: {
    width: "136px",
  },
  colAction: {
    width: "56px",
  },
  th: {
    height: "36px",
    padding: "0 8px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    backgroundColor: tokens.tray,
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
    lineHeight: "16px",
    letterSpacing: tracking.chrome,
    textTransform: "uppercase",
    textAlign: "left",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  row: {
    cursor: "pointer",
    backgroundColor: {
      default: null,
      ":hover": tokens.tray,
      ":focus-within": tokens.tray,
    },
  },
  td: {
    height: "60px",
    padding: "0 8px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    color: tokens.inkMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  firstCell: {
    paddingLeft: "16px",
  },
  strongCell: {
    color: tokens.ink,
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
  },
  inkCell: {
    color: tokens.ink,
  },
  dateCell: {
    fontSize: fontSize.ui,
  },
  lastRowCell: {
    borderBottomWidth: 0,
    borderBottomStyle: "none",
    borderBottomColor: "currentcolor",
  },
  tableOpen: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    width: "100%",
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    color: "inherit",
    textAlign: "left",
    backgroundColor: "transparent",
    cursor: "pointer",
  },
  repository: {
    display: "block",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.inkFaint,
    font: `${fontSize.small}/14px ${tokens.fontMono}`,
  },
  repositoryName: {
    fontWeight: fontWeight.regular,
  },
  repositorySeparator: {
    paddingInline: "5px",
  },
  visuallyHidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
  },
  rowActions: {
    display: "flex",
    justifyContent: "center",
  },
  unavailableRow: {
    opacity: 0.55,
  },
});
