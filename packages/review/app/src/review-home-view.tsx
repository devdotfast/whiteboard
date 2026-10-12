import {
  REVIEW_DISCORD_URL,
  type ReviewApiSummary,
  type ReviewCanvasInstallContent,
  type ReviewCanvasOnboarding,
  type ReviewCanvasSetupActions,
  homeSessions,
} from "@dev.fast/review-protocol";
import { fuzzySegments } from "@review/fuzzy-match";
import * as stylex from "@stylexjs/stylex";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CopyIcon, copyText } from "./copy-text";
import { homeStyles } from "./home-styles";
import { CheckIcon } from "./icons";
import { homeGroupMarker, homeRowMarker } from "./markers.stylex";
import { MenuSurface, menuSurfaceStyles } from "./menu-surface";
import { OptionMenu } from "./option-menu";
import type { ReviewFindHost } from "./review-find";
import {
  HomeFilterPicker,
  type HomeFilterSection,
} from "./review-home-filter-picker";
import {
  type HomeFilters,
  type HomeGroup,
  type HomeSort,
  activeHomeChips,
  defaultHomeFilters,
  groupFor,
  homeGroups,
  matchesHomeFilters,
  repositoryIdentity,
  reviewMetadataPills,
  reviewTitle,
  sortHomeReviews,
  worktreeKey,
  worktreeLabel,
} from "./review-home-model";
import { styles } from "./review-home-styles";
import { withClass } from "./stylex-props";
import { useDismissOnOutside } from "./use-dismiss-on-outside";
import { useTooltip } from "./use-tooltip";

interface ReviewHomeProps {
  findHost?: ReviewFindHost;
  view?: "live" | "deleted";
  onViewChange?(view: "live" | "deleted"): void;
  reviews: readonly ReviewApiSummary[];
  onOpen(review: ReviewApiSummary): void;
  onDeletePermanently?(review: ReviewApiSummary): Promise<void>;
  onDelete?(review: ReviewApiSummary): Promise<void>;
  onRestore?(review: ReviewApiSummary): Promise<void>;
  install?: ReviewCanvasInstallContent;
  setupActions?: ReviewCanvasSetupActions;
  onboarding?: ReviewCanvasOnboarding;
  onOpenTutorial?(): void;
  onOpenSettings?(): void;
  onOpenSetup?(): void;
}

const collapseKey = "review.home.collapsed.v1";

const visitKey = "review.home.lastVisit.v1";

function readCollapsed(): Record<HomeGroup, boolean> {
  const defaults = { unread: false, week: false, earlier: true };

  try {
    const saved = JSON.parse(localStorage.getItem(collapseKey) ?? "{}");

    for (const { id } of homeGroups)
      if (saved?.[id] === true || saved?.[id] === false)
        defaults[id] = saved[id];
  } catch {
    /* Storage is optional. */
  }

  return defaults;
}

function readLastVisit(): number {
  try {
    return Number(localStorage.getItem(visitKey)) || 0;
  } catch {
    return 0;
  }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Home still works without storage. */
  }
}

export function ReviewHome({
  findHost,
  view,
  onViewChange,
  reviews,
  onOpen,
  onDeletePermanently,
  onDelete,
  onRestore,
  onboarding,
  onOpenTutorial,
  onOpenSettings,
  onOpenSetup,
}: ReviewHomeProps) {
  const helpTooltip = useTooltip("Help", { instant: true });
  const settingsTooltip = useTooltip("Settings", { instant: true });

  const [filterState, setFilterState] = useState({
    filters: defaultHomeFilters,
    order: activeHomeChips(defaultHomeFilters),
  });

  const { filters, order: chipOrder } = filterState;

  const setFilters = useCallback(
    (update: (filters: HomeFilters) => HomeFilters) => {
      setFilterState((current) => {
        const next = update(current.filters);

        const active = activeHomeChips(next);

        return {
          filters: next,
          order: [
            ...current.order.filter((id) => active.includes(id)),
            ...active.filter((id) => !current.order.includes(id)),
          ],
        };
      });
    },
    [],
  );

  const [query, setQuery] = useState("");
  const [editingSearch, setEditingSearch] = useState<string | null>(null);

  const [picker, setPicker] = useState<{
    anchor: HTMLButtonElement;
    alignment: "start" | "end";
    section: HomeFilterSection;
  } | null>(null);

  const addFilter = useRef<HTMLButtonElement>(null);
  const addChip = useRef<HTMLButtonElement>(null);
  const [sort, setSort] = useState<HomeSort>("updated");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [selected, setSelected] = useState(new Set<string>());
  const [deleted, setDeleted] = useState(new Set<string>());
  const [lifecycle, setLifecycle] = useState(new Map<string, string | null>());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");

  const [toast, setToast] = useState<{
    kind: "deleted" | "restored" | "permanent";
    targets: ReviewApiSummary[];
  } | null>(null);

  const [localView, setLocalView] = useState<"live" | "deleted">("live");
  const recentlyDeleted = (view ?? localView) === "deleted";

  const hasPublished = useRef(
    onboarding?.published || homeSessions(reviews).length > 0,
  );

  if (onboarding?.published || homeSessions(reviews).length > 0)
    hasPublished.current = true;

  const [confirmation, setConfirmation] = useState<ReviewApiSummary[] | null>(
    null,
  );

  const confirmDialog = useRef<HTMLDialogElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now);
  const [lastVisit] = useState(readLastVisit);
  const [nudgeClosed, setNudgeClosed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [copyNotice, setCopyNotice] = useState<{ copied: boolean } | null>(
    null,
  );

  const [refresherOpen, setRefresherOpen] = useState(false);

  const homeRef = useRef<HTMLElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const lastSelected = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const selectionBar = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(44);
  useDismissOnOutside(helpRef, helpOpen, () => setHelpOpen(false));

  useEffect(() => {
    if (!copyNotice) return;

    const timer = setTimeout(() => setCopyNotice(null), 3000);

    return () => clearTimeout(timer);
  }, [copyNotice]);

  useEffect(() => {
    savePreference(visitKey, String(Date.now()));
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    findHost?.attach({
      showFind(seed) {
        startTextFilter(seed);

        return true;
      },
      hideFind() {
        input.current?.blur();
      },
    });

    return () => findHost?.attach(null);
  });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);

    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (refresherOpen) dialog.current?.showModal();
  }, [refresherOpen]);

  // Hold successful changes until the catalog acknowledges them; allow later reimports.
  useEffect(() => {
    setDeleted((current) => {
      const next = new Set(
        [...current].filter((id) => reviews.some((r) => r.reviewId === id)),
      );

      return next.size === current.size ? current : next;
    });
    setLifecycle((current) => {
      const next = new Map(current);

      for (const [id, value] of current) {
        const review = reviews.find((r) => r.reviewId === id);

        if (!review || Boolean(review.deletedAt) === Boolean(value))
          next.delete(id);
      }

      return next.size === current.size ? current : next;
    });
  }, [reviews]);

  const catalog = useMemo(
    () =>
      homeSessions(reviews)
        .filter((r) => !deleted.has(r.reviewId))
        .map((r) =>
          lifecycle.has(r.reviewId)
            ? { ...r, deletedAt: lifecycle.get(r.reviewId)! }
            : r,
        ),
    [reviews, deleted, lifecycle],
  );

  const trashed = catalog.filter((review) => review.deletedAt);

  const listed = catalog.filter(
    (review) => Boolean(review.deletedAt) === recentlyDeleted,
  );

  useEffect(() => {
    if (confirmation) {
      confirmDialog.current?.showModal();
      cancelDelete.current?.focus();
    }
  }, [confirmation]);

  useLayoutEffect(() => {
    if (editingSearch !== null) input.current?.focus();
  }, [editingSearch]);

  const appliedFilters = {
    ...filters,
    searches: filters.searches.filter(
      (term) => `search:${term}` !== editingSearch,
    ),
  };

  const renderedChips =
    editingSearch === "" ? [...chipOrder, "draft"] : chipOrder;

  useLayoutEffect(() => {
    if (
      picker &&
      picker.section !== "all" &&
      !renderedChips.includes(picker.section)
    ) {
      setPicker(null);
      addFilter.current?.focus();

      return;
    }

    if (picker && !picker.anchor.isConnected) {
      if (picker.section !== "all") {
        const anchor = homeRef.current?.querySelector<HTMLButtonElement>(
          `[data-home-facet="${picker.section}"]`,
        );

        if (anchor) setPicker({ ...picker, anchor });

        return;
      }

      const anchor = addChip.current ?? addFilter.current;

      if (anchor)
        setPicker({
          ...picker,
          anchor,
          alignment: addChip.current ? "start" : "end",
        });
    }
  }, [picker, renderedChips]);

  const searchTerms = [...appliedFilters.searches, query.trim()].filter(
    Boolean,
  );

  const visible = sortHomeReviews(
    listed.filter((r) => matchesHomeFilters(r, appliedFilters, query.trim())),
    sort,
    searchTerms,
  );

  const groups = (
    recentlyDeleted
      ? [{ id: "earlier" as const, label: "Recently deleted" }]
      : homeGroups
  )
    .map((group) => ({
      ...group,
      reviews: recentlyDeleted
        ? visible
        : visible.filter((r) => groupFor(r, now) === group.id),
    }))
    .filter((group) => group.reviews.length > 0);

  const ordered = groups.flatMap((group) => group.reviews);
  const selectedReviews = ordered.filter((r) => selected.has(r.reviewId));
  const selectionMode = selectedReviews.length > 0;

  const searching = searchTerms.length > 0;

  const isCollapsed = (id: HomeGroup) =>
    !recentlyDeleted && !searching && collapsed[id];

  useEffect(() => {
    const bar = selectionBar.current;

    if (!selectionMode || !bar) return;
    const measure = () => setBarHeight(bar.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);

    return () => observer.disconnect();
  }, [selectionMode]);

  // A filter change must never leave invisible destructive targets selected.
  const visibleIds = visible
    .map((r) => r.reviewId)
    .sort()
    .join(",");

  useEffect(() => {
    const ids = new Set(visibleIds.split(","));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => ids.has(id)));

      return next.size === current.size ? current : next;
    });
  }, [visibleIds]);

  function startTextFilter(seed = "", id = "") {
    setPicker(null);

    if (editingSearch !== null) finishTextFilter();

    setEditingSearch(id);
    setQuery(seed);
  }

  function openPicker(
    anchor: HTMLButtonElement,
    alignment: "start" | "end",
    section: HomeFilterSection = "all",
  ) {
    setPicker((current) =>
      current?.anchor === anchor && current.section === section
        ? null
        : { anchor, alignment, section },
    );
  }

  function removeChip(id: string) {
    setFilters((current) => {
      if (id.startsWith("search:"))
        return {
          ...current,
          searches: current.searches.filter((term) => term !== id.slice(7)),
        };

      if (id === "repositories" || id === "worktrees" || id === "branches")
        return { ...current, [id]: [] };

      return { ...current, [id]: false };
    });
  }

  function finishTextFilter(discard = false) {
    if (editingSearch === null) return;
    const term = discard ? "" : query.trim();
    const previous = editingSearch;
    setFilterState((current) => {
      const searches = current.filters.searches.filter(
        (value) => `search:${value}` !== previous,
      );

      if (term && !searches.includes(term)) searches.push(term);
      const next = { ...current.filters, searches };
      const active = activeHomeChips(next);

      const order = current.order.map((id) =>
        id === previous ? `search:${term}` : id,
      );

      return {
        filters: next,
        order: [
          ...new Set([
            ...order.filter((id) => active.includes(id)),
            ...active.filter((id) => !order.includes(id)),
          ]),
        ],
      };
    });
    setEditingSearch(null);
    setQuery("");
  }

  function clearSelection() {
    const focused = document.activeElement;

    // Escape makes a mouse-focused checkbox :focus-visible in Chromium.
    // Relinquish that focus when dismissing selection so it can hide again.
    if (
      focused instanceof HTMLInputElement &&
      focused.matches('[data-home-row] input[type="checkbox"]')
    ) {
      focused.blur();
    }

    setSelected(new Set());
  }

  function toggleGroup(id: HomeGroup) {
    if (searching) return;
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      savePreference(collapseKey, JSON.stringify(next));

      return next;
    });
  }

  function selectGroup(rows: ReviewApiSummary[]) {
    setSelected((current) => {
      const next = new Set(current);
      const all = rows.every((r) => current.has(r.reviewId));

      for (const row of rows) {
        if (all) next.delete(row.reviewId);
        else next.add(row.reviewId);
      }

      return next;
    });
  }

  function toggleRow(id: string, range = false) {
    const rows = groups.flatMap((group) =>
      isCollapsed(group.id) ? [] : group.reviews,
    );

    const from = rows.findIndex((r) => r.reviewId === lastSelected.current);
    const to = rows.findIndex((r) => r.reviewId === id);
    setSelected((current) => {
      const next = new Set(current);

      if (range && from >= 0 && to >= 0) {
        for (const row of rows.slice(
          Math.min(from, to),
          Math.max(from, to) + 1,
        ))
          next.add(row.reviewId);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
    lastSelected.current = id;
  }

  function openDeletedView(value: boolean) {
    clearSelection();
    clearFilters();
    const next = value ? "deleted" : "live";
    setLocalView(next);
    onViewChange?.(next);
  }

  useEffect(() => {
    clearSelection();
    clearFilters();
    setSort(recentlyDeleted ? "deleted" : "updated");
  }, [recentlyDeleted]);

  async function changeLifecycle(
    targets = selectedReviews,
    restore = false,
    undoing = false,
  ) {
    const action = restore ? onRestore : onDelete;

    if (!action || busyRef.current || !targets.length) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const succeeded: ReviewApiSummary[] = [];
    const failed = new Set<string>();
    const messages: string[] = [];

    const timestamp = restore ? null : new Date().toISOString();
    setLifecycle((current) => {
      const next = new Map(current);

      for (const review of targets) next.set(review.reviewId, timestamp);

      return next;
    });
    clearSelection();

    for (const review of targets) {
      try {
        await action(review);
        succeeded.push(review);
      } catch (cause) {
        failed.add(review.reviewId);
        messages.push(cause instanceof Error ? cause.message : String(cause));
      }
    }

    if (failed.size)
      setLifecycle((current) => {
        const next = new Map(current);

        for (const review of targets)
          if (failed.has(review.reviewId))
            next.set(review.reviewId, review.deletedAt);

        return next;
      });
    setSelected(failed);

    if (failed.size)
      setError(
        `Could not ${restore ? "restore" : "delete"} ${countLabel(failed.size, "whiteboard")}. ${messages.join(" ")}`,
      );

    if (undoing)
      setToast(
        failed.size
          ? {
              kind: restore ? "deleted" : "restored",
              targets: targets.filter((review) => failed.has(review.reviewId)),
            }
          : null,
      );
    else if (succeeded.length)
      setToast({ kind: restore ? "restored" : "deleted", targets: succeeded });
    busyRef.current = false;
    setBusy(false);
  }

  function undoToast() {
    if (toast && toast.kind !== "permanent")
      void changeLifecycle(toast.targets, toast.kind === "deleted", true);
  }

  function deleteSelection(targets = selectedReviews) {
    if (!targets.length) return;

    if (recentlyDeleted) setConfirmation([...targets]);
    else void changeLifecycle(targets);
  }

  async function deletePermanently() {
    if (!onDeletePermanently || !confirmation || busyRef.current) return;
    const targets = confirmation;
    setConfirmation(null);
    busyRef.current = true;
    setBusy(true);
    setError("");
    const succeeded: ReviewApiSummary[] = [];
    const failed = new Set<string>();
    const messages: string[] = [];

    setDeleted(
      (current) =>
        new Set([...current, ...targets.map((review) => review.reviewId)]),
    );
    clearSelection();

    for (const review of targets) {
      try {
        await onDeletePermanently(review);
        succeeded.push(review);
      } catch (cause) {
        failed.add(review.reviewId);
        messages.push(cause instanceof Error ? cause.message : String(cause));
      }
    }

    if (failed.size)
      setDeleted(
        (current) => new Set([...current].filter((id) => !failed.has(id))),
      );
    setSelected(failed);

    if (failed.size)
      setError(
        `Could not permanently delete ${countLabel(failed.size, "whiteboard")}. ${messages.join(" ")}`,
      );

    if (succeeded.length) setToast({ kind: "permanent", targets: succeeded });
    busyRef.current = false;
    setBusy(false);
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // An open menu owns keyboard input until it closes. In particular, its
      // Escape must not also clear the selection below it.
      if (
        event.defaultPrevented ||
        confirmation ||
        refresherOpen ||
        helpOpen ||
        homeRef.current?.querySelector(
          '[aria-haspopup="menu"][aria-expanded="true"]',
        )
      )
        return;
      const target = event.target;

      const editing =
        target instanceof HTMLElement &&
        Boolean(
          target.closest(
            'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]',
          ),
        );

      const command = /Mac|iPhone|iPad/.test(navigator.platform)
        ? event.metaKey
        : event.ctrlKey;

      const key = event.key.toLowerCase();

      if (command && key === "f") {
        event.preventDefault();
        event.stopPropagation();
        startTextFilter();

        return;
      }

      if (picker !== null) return;

      if (
        !editing &&
        command &&
        key === "z" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.repeat &&
        toast &&
        toast.kind !== "permanent" &&
        !busyRef.current
      ) {
        event.preventDefault();
        event.stopPropagation();
        undoToast();
      } else if (!editing && !command && !event.altKey && key === "f") {
        event.preventDefault();

        if (addFilter.current) openPicker(addFilter.current, "end");
      } else if (command && key === "," && onOpenSettings) {
        event.preventDefault();
        event.stopPropagation();
        onOpenSettings();
      } else if (key === "escape") {
        if (document.activeElement === input.current) {
          event.preventDefault();
          finishTextFilter(true);
        } else if (selectionMode) {
          event.preventDefault();
          clearSelection();
        }
      } else if (!editing && command && key === "a") {
        event.preventDefault();
        event.stopPropagation();
        setSelected(new Set(visible.map((r) => r.reviewId)));
      } else if (!editing && command && key === "backspace" && !event.repeat) {
        const rowId =
          target instanceof HTMLElement
            ? target.closest<HTMLElement>("[data-home-row]")?.dataset.homeRow
            : undefined;

        const focused = visible.find((review) => review.reviewId === rowId);

        if (selectionMode || focused) {
          event.preventDefault();
          deleteSelection(selectionMode ? selectedReviews : [focused!]);
        }
      } else if (!editing && selectionMode && !event.repeat) {
        if (recentlyDeleted && !command && !event.altKey && key === "r") {
          event.preventDefault();
          void changeLifecycle(selectedReviews, true);
        }
      }
    };

    window.addEventListener("keydown", keydown, true);

    return () => window.removeEventListener("keydown", keydown, true);
  });

  const text = searchTerms.join("” and “");

  const filterCount =
    Number(filters.unread) +
    Number(filters.repositories.length > 0) +
    Number(filters.worktrees.length > 0) +
    Number(filters.branches.length > 0);

  const hidden = listed.length - visible.length;

  const cause = [
    text ? `“${text}”` : "",
    filterCount ? countLabel(filterCount, "filter") : "",
  ]
    .filter(Boolean)
    .join(" and ");

  const completed = onboarding
    ? Number(onboarding.installed) +
      Number(
        onboarding.tutorialTotal > 0 &&
          onboarding.tutorialChecked >= onboarding.tutorialTotal,
      ) +
      Number(onboarding.published)
    : 3;

  const setupIncomplete =
    !recentlyDeleted && !hasPublished.current && completed < 3;

  const weeksAway =
    lastVisit > 0 ? Math.floor((now - lastVisit) / (7 * 86400000)) : 0;

  function clearFilters() {
    setPicker(null);
    setFilters(() => ({ ...defaultHomeFilters }));
    setQuery("");
    setEditingSearch(null);
  }

  function showHelp() {
    setHelpOpen(false);
    setRefresherOpen(true);
  }

  const renderChip = (id: string) => {
    if (id === "draft" || id === editingSearch) {
      return (
        <span key={id} {...stylex.props(styles.chip, styles.editingChip)}>
          <span {...stylex.props(styles.editingIcon)}>
            <HomeIcon kind="search" size="small" />
          </span>
          <input
            ref={input}
            aria-label="Search whiteboards"
            role="searchbox"
            spellCheck={false}
            value={query}
            {...stylex.props(
              styles.textChipInput,
              styles.textChipWidth(Math.max(5, query.length + 1)),
            )}
            onChange={(event) => setQuery(event.target.value)}
            onBlur={() => finishTextFilter()}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;

              if (event.key === "Enter") {
                event.preventDefault();
                finishTextFilter();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                homeRef.current
                  ?.querySelector<HTMLButtonElement>(
                    '[data-home-row] button[aria-label^="Open "]',
                  )
                  ?.focus();
              } else if (event.key === "Backspace" && !query) {
                event.preventDefault();
                finishTextFilter(true);
              }
            }}
          />
          <span
            role="status"
            aria-label="Matching whiteboards"
            {...stylex.props(styles.textChipCount)}
          >
            {visible.length}
          </span>
        </span>
      );
    }

    if (id.startsWith("search:")) {
      const term = id.slice(7);

      return (
        <Chip
          key={id}
          label={term}
          content={
            <>
              <span {...stylex.props(styles.textChipIcon)}>
                <HomeIcon kind="search" size="small" />
              </span>
              <span data-chip-value {...stylex.props(styles.chipValue)}>
                {term}
              </span>
            </>
          }
          onOpen={() => startTextFilter(term, id)}
          onRemove={() => removeChip(id)}
        />
      );
    }

    const facet =
      id === "repositories" || id === "worktrees" || id === "branches"
        ? id
        : null;

    const name =
      facet === "repositories"
        ? "Repo"
        : facet === "branches"
          ? "Branch"
          : "Worktree";

    const values = facet
      ? filters[facet].map((key) => {
          if (facet === "branches") return key;

          const review = listed.find((r) =>
            facet === "repositories"
              ? repositoryIdentity(r)?.key === key
              : worktreeKey(r) === key,
          );

          return review
            ? facet === "repositories"
              ? repositoryIdentity(review)!.label
              : worktreeLabel(review)
            : key;
        })
      : [];

    const valueLabel =
      values.length > 1 ? `${values[0]} +${values.length - 1}` : values[0];

    const label = facet ? `${name} ${valueLabel}` : "Unread only";

    return (
      <Chip
        key={id}
        label={label}
        facet={facet ? name : undefined}
        values={values}
        content={
          facet ? (
            <>
              <span {...stylex.props(styles.chipFacet)}>{name}</span>
              <span data-chip-value {...stylex.props(styles.chipValue)}>
                {values[0]}
              </span>
              {values.length > 1 && (
                <span {...stylex.props(styles.chipFacet)}>
                  +{values.length - 1}
                </span>
              )}
            </>
          ) : undefined
        }
        facetId={id}
        open={picker?.section === id}
        onOpen={(event) =>
          openPicker(event.currentTarget, "start", facet ?? "unread")
        }
        onRemove={() => removeChip(id)}
      />
    );
  };

  return (
    <main ref={homeRef} {...withClass("review-home", homeStyles.page)}>
      <div
        data-home-scroll
        {...stylex.props(
          homeStyles.scroll,
          styles.scroll,
          selectionMode && styles.selectionSpace(barHeight),
        )}
      >
        <div {...stylex.props(homeStyles.content, styles.content)}>
          <header {...stylex.props(styles.header)}>
            {recentlyDeleted ? (
              <>
                <div {...stylex.props(styles.deletedHeading)}>
                  <h1 {...stylex.props(styles.deletedTitle)}>
                    Recently deleted
                  </h1>
                  <span {...stylex.props(styles.deletedSeparator)}>
                    {trashed.length}
                  </span>
                </div>
                <p {...stylex.props(styles.retentionNote)}>
                  Deleted whiteboards are removed for good after 30 days.
                </p>
              </>
            ) : (
              <h1 {...stylex.props(styles.heading)}>Whiteboards</h1>
            )}
            <div
              hidden={recentlyDeleted}
              {...stylex.props(
                styles.controls,
                styles.headerControls,
                recentlyDeleted && styles.hidden,
              )}
            >
              <div ref={helpRef} {...stylex.props(styles.helpWrap)}>
                <button
                  type="button"
                  aria-label="Help"
                  ref={helpTooltip}
                  aria-haspopup="menu"
                  aria-expanded={helpOpen}
                  {...stylex.props(
                    styles.iconButton,
                    styles.headerIconButton,
                    helpOpen && styles.headerIconOpen,
                  )}
                  onClick={() => setHelpOpen(!helpOpen)}
                >
                  <HomeIcon kind="help" />
                </button>
                {helpOpen && (
                  <MenuSurface
                    role="menu"
                    tabIndex={-1}
                    aria-label="Help"
                    xstyle={styles.menu}
                    onClose={() => {
                      setHelpOpen(false);
                      helpRef.current?.querySelector("button")?.focus();
                    }}
                  >
                    <button
                      role="menuitem"
                      {...stylex.props(menuSurfaceStyles.item)}
                      disabled={!onOpenTutorial}
                      onClick={() => {
                        setHelpOpen(false);
                        onOpenTutorial?.();
                      }}
                    >
                      Need a refresher? Take the tour
                    </button>
                    <hr {...stylex.props(styles.divider)} />
                    <a
                      role="menuitem"
                      {...stylex.props(menuSurfaceStyles.item)}
                      href={REVIEW_DISCORD_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ask on Discord ↗
                    </a>
                    <button
                      role="menuitem"
                      {...stylex.props(
                        menuSurfaceStyles.item,
                        styles.copyEmail,
                      )}
                      onClick={async () => {
                        const copied = await copyText("founders@dev.fast");
                        setCopyNotice({ copied });
                      }}
                    >
                      Need help? Send us an email
                      <CopyIcon />
                    </button>
                  </MenuSurface>
                )}
              </div>
              <button
                type="button"
                aria-label="Settings"
                ref={settingsTooltip}
                disabled={!onOpenSettings}
                {...stylex.props(styles.iconButton, styles.headerIconButton)}
                onClick={onOpenSettings}
              >
                <HomeIcon kind="settings" />
              </button>
            </div>
          </header>
          {setupIncomplete ? (
            <div {...stylex.props(styles.notice)}>
              <span {...stylex.props(styles.noticeText)}>
                Finish setting up Whiteboard · {completed} of 3 done · next:{" "}
                {!onboarding?.installed
                  ? "connect your agent"
                  : onboarding.tutorialChecked < onboarding.tutorialTotal
                    ? "take the tour"
                    : "create your first whiteboard"}
              </span>
              <button
                {...stylex.props(styles.control)}
                onClick={onOpenSetup ?? onOpenTutorial}
              >
                Continue setup
              </button>
            </div>
          ) : !recentlyDeleted && weeksAway >= 2 && !nudgeClosed ? (
            <div {...stylex.props(styles.notice)}>
              <span {...stylex.props(styles.noticeText)}>
                Welcome back. It’s been {weeksAway} weeks — boards, lenses and
                Ask in a 3-minute refresher.
              </span>
              <button
                {...stylex.props(styles.control)}
                onClick={() => showHelp()}
              >
                Refresh me
              </button>
              <button
                aria-label="Close welcome back"
                {...stylex.props(styles.iconButton)}
                onClick={() => setNudgeClosed(true)}
              >
                ×
              </button>
            </div>
          ) : null}
          {error && <p role="alert">{error}</p>}
          <div {...stylex.props(styles.filterRegion)}>
            <div {...stylex.props(styles.toolbar)}>
              <div aria-label="Active filters" {...stylex.props(styles.chips)}>
                {renderedChips.map((id, index) =>
                  index === renderedChips.length - 1 ? (
                    <span
                      key={id}
                      data-chip-tail
                      {...stylex.props(styles.chipTail)}
                    >
                      {renderChip(id)}
                      <button
                        ref={addChip}
                        aria-label="Add filter"
                        title="Add filter  F"
                        aria-haspopup="dialog"
                        aria-expanded={picker?.anchor === addChip.current}
                        {...stylex.props(styles.addFilter)}
                        onClick={(event) =>
                          openPicker(event.currentTarget, "start")
                        }
                      >
                        +
                      </button>
                    </span>
                  ) : (
                    renderChip(id)
                  ),
                )}
              </div>
              <div {...stylex.props(styles.controls)}>
                {renderedChips.length > 0 && (
                  <button
                    {...stylex.props(styles.clearAll)}
                    onClick={clearFilters}
                  >
                    Clear all
                  </button>
                )}
                <button
                  ref={addFilter}
                  aria-label="Add filters"
                  title="Add filter  F"
                  aria-haspopup="dialog"
                  aria-expanded={picker?.anchor === addFilter.current}
                  {...stylex.props(
                    styles.control,
                    styles.toolbarControl,
                    styles.filterButton,
                    picker?.anchor === addFilter.current &&
                      styles.addFilterActive,
                  )}
                  onClick={(event) => openPicker(event.currentTarget, "end")}
                >
                  <HomeIcon kind="filter" />
                  Filter
                </button>
                <OptionMenu<HomeSort>
                  ariaLabel="Sort whiteboards"
                  value={sort}
                  options={[
                    ...(recentlyDeleted
                      ? [{ value: "deleted" as const, label: "Deleted" }]
                      : []),
                    { value: "updated", label: "Updated" },
                    { value: "created", label: "Created" },
                    { value: "title", label: "Title" },
                  ]}
                  onChange={setSort}
                  triggerStyle={[styles.control, styles.toolbarControl]}
                >
                  <HomeIcon kind="sort" size="small" />
                  <span {...stylex.props(styles.muted)}>Sort</span>
                  {sort[0].toUpperCase() + sort.slice(1)}
                </OptionMenu>
              </div>
            </div>
            {picker !== null && (
              <HomeFilterPicker
                key={picker.section}
                anchor={picker.anchor}
                alignment={picker.alignment}
                section={picker.section}
                reviews={listed}
                filters={appliedFilters}
                query={query}
                onChange={setFilters}
                onSearch={() => startTextFilter()}
                count={visible.length}
                onClose={() => {
                  setPicker(null);
                  picker.anchor.focus();
                }}
              />
            )}
          </div>
          {!visible.length && (
            <p {...stylex.props(styles.muted)}>
              {hidden
                ? "No matching whiteboards."
                : recentlyDeleted
                  ? "No recently deleted whiteboards."
                  : "No whiteboards yet."}
            </p>
          )}
          <div {...stylex.props(styles.list)}>
            {groups.map((group) => {
              const count = group.reviews.filter((r) =>
                selected.has(r.reviewId),
              ).length;

              return (
                <section
                  key={group.id}
                  aria-label={group.label}
                  {...stylex.props(homeGroupMarker, styles.group)}
                >
                  {!recentlyDeleted && (
                    <div {...stylex.props(styles.groupHeader)}>
                      <button
                        aria-expanded={!isCollapsed(group.id)}
                        {...stylex.props(styles.groupToggle)}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <span {...stylex.props(styles.caret)}>
                          <HomeIcon
                            kind={isCollapsed(group.id) ? "right" : "down"}
                            size="caret"
                          />
                        </span>
                        <span {...stylex.props(styles.caret)}>
                          {group.id === "unread" && (
                            <span {...stylex.props(styles.dot)} />
                          )}
                        </span>
                        <span data-home-group-label="">{group.label}</span>
                        <span
                          {...stylex.props(styles.muted, styles.groupCount)}
                        >
                          {group.reviews.length}
                        </span>
                      </button>
                      <div {...stylex.props(styles.groupSelection)}>
                        {count > 0 && (
                          <span>
                            {count === group.reviews.length
                              ? `All ${count} selected`
                              : `${count} of ${group.reviews.length} selected`}
                          </span>
                        )}
                        <button
                          {...stylex.props(
                            styles.control,
                            styles.compactControl,
                            styles.groupSelect,
                          )}
                          onClick={() => selectGroup(group.reviews)}
                        >
                          {count === group.reviews.length
                            ? "Deselect"
                            : count > 0
                              ? "Select all"
                              : `Select all ${group.reviews.length}`}
                        </button>
                      </div>
                    </div>
                  )}
                  {!isCollapsed(group.id) &&
                    group.reviews.map((review, index) => (
                      <div
                        key={review.reviewId}
                        data-home-row={review.reviewId}
                        {...stylex.props(
                          homeRowMarker,
                          styles.row,
                          styles.waterfallRow(index),
                          selected.has(review.reviewId) && styles.selected,
                          selected.has(review.reviewId) &&
                            index > 0 &&
                            selected.has(group.reviews[index - 1].reviewId) &&
                            styles.selectedAfter,
                          selected.has(review.reviewId) &&
                            index < group.reviews.length - 1 &&
                            selected.has(group.reviews[index + 1].reviewId) &&
                            styles.selectedBefore,
                        )}
                        onClick={() => onOpen(review)}
                        onKeyDown={(event) => {
                          if (
                            event.key.toLowerCase() === "x" &&
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.altKey
                          ) {
                            event.preventDefault();
                            toggleRow(review.reviewId);
                          }
                        }}
                      >
                        <SelectionCheckbox
                          label={`Select ${reviewTitle(review)}`}
                          checked={selected.has(review.reviewId)}
                          hidden={!selected.has(review.reviewId)}
                          onToggle={(range) =>
                            toggleRow(review.reviewId, range)
                          }
                        />
                        <span
                          {...stylex.props(styles.kindIcon)}
                          title={review.working ? "Agent writing" : undefined}
                        >
                          {review.working ? (
                            <span {...stylex.props(styles.writingDot)} />
                          ) : (
                            <HomeIcon
                              kind={
                                review.origin?.pullRequestNumber
                                  ? "code"
                                  : "board"
                              }
                            />
                          )}
                        </span>
                        <button
                          aria-label={`Open ${reviewTitle(review)}`}
                          {...stylex.props(styles.rowOpen)}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(review);
                          }}
                        >
                          <span
                            title={reviewTitle(review)}
                            {...stylex.props(
                              styles.title,
                              Boolean(review.deletedAt) && styles.archived,
                            )}
                          >
                            <MatchedText
                              text={reviewTitle(review)}
                              queries={searchTerms}
                            />
                          </span>
                        </button>
                        <span
                          data-home-metadata=""
                          {...stylex.props(styles.metadata)}
                        >
                          {reviewMetadataPills(review, appliedFilters)
                            .filter(
                              (pill) =>
                                !recentlyDeleted || pill.facet === "worktrees",
                            )
                            .map((pill) => (
                              <button
                                key={pill.facet}
                                type="button"
                                aria-label={`Filter ${pill.facet === "branches" ? "branch" : "worktree"}: ${pill.label}`}
                                title={pill.label}
                                {...stylex.props(styles.metadataPill)}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setFilters((current) => ({
                                    ...current,
                                    [pill.facet]: [
                                      ...new Set([
                                        ...current[pill.facet],
                                        pill.key,
                                      ]),
                                    ],
                                  }));
                                }}
                              >
                                <HomeIcon
                                  kind={
                                    pill.facet === "branches"
                                      ? "branch"
                                      : "folder"
                                  }
                                  size="small"
                                />
                                {pill.facet === "branches" ? (
                                  <MiddleTruncatedText
                                    text={pill.label}
                                    queries={searchTerms}
                                  />
                                ) : (
                                  <span {...stylex.props(styles.pillText)}>
                                    <MatchedText
                                      text={pill.label}
                                      queries={searchTerms}
                                    />
                                  </span>
                                )}
                              </button>
                            ))}
                        </span>
                        <span
                          {...stylex.props(
                            styles.time,
                            recentlyDeleted &&
                              Date.parse(review.deletedAt!) +
                                30 * 86400000 -
                                now <
                                3 * 86400000 &&
                              styles.expiring,
                          )}
                          title={
                            recentlyDeleted
                              ? review.deletedAt!
                              : review.createdAt
                          }
                        >
                          {recentlyDeleted
                            ? `${Math.min(30, Math.max(0, Math.ceil((Date.parse(review.deletedAt!) + 30 * 86400000 - now) / 86400000)))} days left`
                            : formatRelativeTime(review.createdAt, now)}
                        </span>
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
          {hidden > 0 && (
            <footer {...stylex.props(styles.footer)}>
              {hidden > 0 && (
                <div>
                  {countLabel(hidden, "whiteboard")} hidden by {cause} ·{" "}
                  <button
                    {...stylex.props(styles.link, styles.footerAction)}
                    onClick={clearFilters}
                  >
                    Clear filters ×
                  </button>
                </div>
              )}
            </footer>
          )}
          {!recentlyDeleted && trashed.length > 0 && (
            <footer {...stylex.props(styles.footer)}>
              <button
                {...stylex.props(styles.link)}
                onClick={() => openDeletedView(true)}
              >
                {trashed.length} recently deleted ›
              </button>
            </footer>
          )}
        </div>
      </div>
      {toast && (
        <div
          role="status"
          {...stylex.props(
            styles.copyNotice,
            styles.actionNotice,
            toast.kind !== "deleted" && styles.compactNotice,
          )}
        >
          <CheckIcon xstyle={styles.actionNoticeIcon} />
          <div
            {...stylex.props(
              styles.actionNoticeContent,
              toast.kind !== "deleted" && styles.compactNoticeContent,
            )}
          >
            <span {...stylex.props(styles.actionNoticeText)}>
              {toast.kind === "permanent"
                ? "Permanently deleted"
                : toast.kind === "deleted"
                  ? "Deleted"
                  : "Restored"}{" "}
              {countLabel(toast.targets.length, "whiteboard")}.
            </span>
            {toast.kind === "deleted" && (
              <span {...stylex.props(styles.toastSubtitle)}>
                You can restore them for 30 days.
              </span>
            )}
            {toast.kind !== "permanent" && (
              <div
                {...stylex.props(
                  styles.toastActions,
                  toast.kind === "restored" && styles.compactNoticeActions,
                )}
              >
                <button
                  aria-label="Undo"
                  aria-keyshortcuts="Meta+Z Control+Z"
                  disabled={busy}
                  {...stylex.props(styles.barButton, styles.toastButton)}
                  onClick={undoToast}
                >
                  Undo <span {...stylex.props(styles.toastShortcut)}>⌘Z</span>
                </button>
                {toast.kind === "deleted" && (
                  <button
                    {...stylex.props(styles.barButton, styles.toastButton)}
                    onClick={() => {
                      openDeletedView(true);
                      setToast(null);
                    }}
                  >
                    View recently deleted
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            aria-label="Dismiss notification"
            {...stylex.props(styles.copyNoticeDismiss)}
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}
      {confirmation && (
        <dialog
          ref={confirmDialog}
          aria-labelledby="permanent-delete-title"
          {...stylex.props(styles.dialog, styles.permanentDialog)}
          onCancel={() => setConfirmation(null)}
          onClose={() => setConfirmation(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        >
          <h2
            id="permanent-delete-title"
            {...stylex.props(styles.confirmHeading)}
          >
            Permanently delete {countLabel(confirmation.length, "whiteboard")}?
          </h2>
          <p {...stylex.props(styles.confirmBody)}>
            “{reviewTitle(confirmation[0])}”
            {confirmation.length > 1
              ? ` and ${countLabel(confirmation.length - 1, "other")}`
              : ""}{" "}
            will be removed for good, along with their versions and threads.
            This can't be undone.
          </p>
          <div {...stylex.props(styles.controls, styles.confirmActions)}>
            <button
              ref={cancelDelete}
              {...stylex.props(styles.control)}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </button>
            <button
              {...stylex.props(styles.control, styles.confirmDanger)}
              onClick={() => void deletePermanently()}
            >
              Delete permanently
            </button>
          </div>
        </dialog>
      )}
      {selectionMode && (
        <div
          ref={selectionBar}
          role="toolbar"
          aria-label="Selected whiteboards"
          {...stylex.props(styles.bar)}
        >
          <span {...stylex.props(styles.barCount)}>
            {selectedReviews.length} selected
          </span>
          <button
            disabled={busy}
            {...stylex.props(styles.barButton)}
            onClick={() => setSelected(new Set(visible.map((r) => r.reviewId)))}
          >
            Select all {visible.length}{" "}
            <span {...stylex.props(styles.barShortcut)}>⌘A</span>
          </button>
          {recentlyDeleted && (
            <button
              disabled={busy || !onRestore}
              {...stylex.props(styles.barButton)}
              onClick={() => void changeLifecycle(selectedReviews, true)}
            >
              Restore <span {...stylex.props(styles.barShortcut)}>R</span>
            </button>
          )}
          <button
            disabled={
              busy || !(recentlyDeleted ? onDeletePermanently : onDelete)
            }
            {...stylex.props(styles.barButton, styles.danger)}
            onClick={() => deleteSelection()}
          >
            {recentlyDeleted ? "Delete permanently…" : "Delete"}{" "}
            <span {...stylex.props(styles.barShortcut)}>⌘⌫</span>
          </button>
          <span aria-hidden="true" {...stylex.props(styles.barDivider)} />
          <button
            aria-label="Clear selection"
            {...stylex.props(styles.barButton, styles.barClose)}
            onClick={clearSelection}
          >
            <HomeIcon kind="close" size="small" />
          </button>
        </div>
      )}
      {refresherOpen && (
        <dialog
          ref={dialog}
          aria-labelledby="home-help-title"
          {...stylex.props(styles.dialog)}
          onClose={() => setRefresherOpen(false)}
          onCancel={(event) => {
            event.preventDefault();
            setRefresherOpen(false);
          }}
        >
          <div {...stylex.props(styles.header)}>
            <h2 id="home-help-title">How Whiteboard works</h2>
            <button
              aria-label="Close help"
              {...stylex.props(styles.iconButton)}
              onClick={() => setRefresherOpen(false)}
            >
              ×
            </button>
          </div>
          <>
            <p>A 3-minute refresher</p>
            <h3>Boards hold the work</h3>
            <p>
              Your agent publishes a whiteboard to explain a change, explore a
              design, or share a plan. Open a board to read it alongside its
              code and diagrams. Home collects those boards across your
              repositories.
            </p>
            <h3>Lenses give you a path</h3>
            <p>
              A lens focuses the board on a particular question. Follow its
              steps to move between explanations, source, and diagrams without
              losing your place.
            </p>
            <h3>Ask where you are</h3>
            <p>
              Select the part you want to understand and use Ask to discuss it
              with your agent. Keep the conversation beside the work, then
              follow the agent’s updates on the board.
            </p>
            <h3>Find your way back</h3>
            <p>
              Unread contains new boards and updates since your last visit to a
              board. Search titles, worktrees, branches or repositories, or add
              filters with the filter icon; Sort orders each group. Delete keeps
              completed work out of the way until you need it again.
            </p>
            <button
              {...stylex.props(styles.control)}
              disabled={!onOpenTutorial}
              onClick={() => {
                setRefresherOpen(false);
                onOpenTutorial?.();
              }}
            >
              Take the tour
            </button>
          </>
        </dialog>
      )}
      {copyNotice && (
        <div {...stylex.props(styles.copyNotice)}>
          <span role="status" {...stylex.props(styles.copyNoticeMessage)}>
            {copyNotice.copied && <CheckIcon />}
            {copyNotice.copied
              ? "Copied 'founders@dev.fast' to clipboard"
              : "Couldn't copy email. Please try again."}
          </span>
          <button
            aria-label="Dismiss clipboard notification"
            {...stylex.props(styles.copyNoticeDismiss)}
            onClick={() => setCopyNotice(null)}
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}

function Chip({
  label,
  content,
  facet,
  values = [],
  facetId,
  open = false,
  onOpen,
  onRemove,
}: {
  label: string;
  content?: ReactNode;
  facet?: string;
  values?: string[];
  facetId?: string;
  open?: boolean;
  onOpen(event: React.MouseEvent<HTMLButtonElement>): void;
  onRemove(): void;
}) {
  const tooltipId = useId();
  const tooltip = useRef<HTMLSpanElement>(null);
  const tooltipAnchor = useRef<HTMLButtonElement>(null);
  const [showValues, setShowValues] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 });

  const openTooltip = (target: HTMLButtonElement) => {
    if (open) return;
    const value = target.querySelector<HTMLElement>("[data-chip-value]");

    if (values.length > 1 || (value && value.scrollWidth > value.clientWidth)) {
      setShowValues(true);
    }
  };

  useLayoutEffect(() => {
    if (!showValues || !tooltip.current || !tooltipAnchor.current) return;
    const rect = tooltip.current.getBoundingClientRect();
    const anchor = tooltipAnchor.current.getBoundingClientRect();

    const bounds = tooltip.current
      .closest(".review-canvas-root")
      ?.getBoundingClientRect();

    const left = bounds?.left ?? 0;
    const top = bounds?.top ?? 0;
    setTooltipPosition({
      left:
        Math.max(
          left + 12,
          Math.min(
            anchor.left,
            (bounds?.right ?? window.innerWidth) - rect.width - 12,
          ),
        ) - left,
      top:
        Math.max(
          top + 12,
          Math.min(
            anchor.bottom,
            (bounds?.bottom ?? window.innerHeight) - rect.height - 12,
          ),
        ) - top,
    });
  }, [showValues]);
  useEffect(() => {
    if (!showValues) return;
    const close = () => setShowValues(false);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [showValues]);

  return (
    <span
      {...stylex.props(styles.chip, styles.chipAnchor, open && styles.pressed)}
      onPointerLeave={() => setShowValues(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setShowValues(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setShowValues(false);
      }}
    >
      <button
        ref={tooltipAnchor}
        data-home-facet={facetId}
        aria-haspopup={facetId ? "dialog" : undefined}
        aria-expanded={facetId ? open : undefined}
        {...stylex.props(styles.chipText)}
        aria-label={label}
        aria-describedby={showValues ? tooltipId : undefined}
        onPointerEnter={(event) => openTooltip(event.currentTarget)}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible"))
            openTooltip(event.currentTarget);
        }}
        onClick={(event) => {
          setShowValues(false);
          onOpen(event);
        }}
      >
        {content ?? (
          <span data-chip-value {...stylex.props(styles.chipValue)}>
            {label}
          </span>
        )}
      </button>
      {showValues && !open && (
        <span
          ref={tooltip}
          id={tooltipId}
          role="dialog"
          aria-label={`${facet ?? "Search"} filter details`}
          {...stylex.props(
            styles.facetTooltipBridge,
            styles.tooltipPosition(tooltipPosition.left, tooltipPosition.top),
          )}
        >
          <span {...stylex.props(styles.facetTooltip)}>
            {values.length > 1 && (
              <span {...stylex.props(styles.tooltipHeading)}>
                {facet} is any of {values.length}
              </span>
            )}
            <span {...stylex.props(styles.tooltipValues)}>
              {values.length ? values.join("\n") : label}
            </span>
            <button
              {...stylex.props(styles.tooltipHint)}
              onClick={() => tooltipAnchor.current?.click()}
            >
              Click to edit
            </button>
          </span>
        </span>
      )}
      <button
        onMouseDown={(event) => event.preventDefault()}
        aria-label={`Remove ${label}`}
        {...stylex.props(styles.chipClose)}
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  );
}

function SelectionCheckbox({
  label,
  checked,
  hidden,
  onToggle,
}: {
  label: string;
  checked: boolean;
  hidden: boolean;
  onToggle(range: boolean): void;
}) {
  return (
    <span
      {...stylex.props(styles.checkboxSlot, hidden && styles.hiddenCheck)}
      title="Select  x"
    >
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        {...stylex.props(styles.checkbox)}
        onChange={() => {}}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(event.shiftKey);
        }}
      />
      <span
        aria-hidden="true"
        {...stylex.props(styles.checkboxBox, checked && styles.checkboxChecked)}
      >
        {checked && (
          <svg viewBox="0 0 10 10" {...stylex.props(styles.checkGlyph)}>
            <path d="M2 5.2 4.2 7.4 8 3.2" />
          </svg>
        )}
      </span>
    </span>
  );
}

function MiddleTruncatedText({
  text,
  queries,
}: {
  text: string;
  queries: string[];
}) {
  // Let the prefix elide first while retaining the branch's final path component.
  const split = text.includes("/")
    ? text.lastIndexOf("/") + 1
    : Math.ceil(text.length * 0.75);

  return (
    <span {...stylex.props(styles.metadataPart)}>
      <span {...stylex.props(styles.metadataPrefix)}>
        <MatchedText text={text} queries={queries} to={split} />
      </span>
      <span {...stylex.props(styles.metadataSuffix)}>
        <bdi>
          <MatchedText text={text} queries={queries} from={split} />
        </bdi>
      </span>
    </span>
  );
}

function MatchedText({
  text,
  queries,
  from = 0,
  to = text.length,
}: {
  text: string;
  queries: string[];
  from?: number;
  to?: number;
}) {
  const matched = new Set<number>();

  for (const query of queries) {
    let offset = 0;

    for (const segment of fuzzySegments(query, text)) {
      if (segment.matched)
        for (let i = offset; i < offset + segment.text.length; i++)
          matched.add(i);
      offset += segment.text.length;
    }
  }

  const segments: { text: string; matched: boolean }[] = [];

  for (let start = from; start < to; ) {
    let end = start + 1;

    while (end < to && matched.has(end) === matched.has(start)) end++;
    segments.push({
      text: text.slice(start, end),
      matched: matched.has(start),
    });
    start = end;
  }

  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.matched ? (
            <mark {...stylex.props(styles.mark)}>{segment.text}</mark>
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </>
  );
}

function HomeIcon({
  kind,
  size,
}: {
  kind:
    | "help"
    | "settings"
    | "search"
    | "filter"
    | "branch"
    | "folder"
    | "board"
    | "code"
    | "pr"
    | "sort"
    | "right"
    | "down"
    | "close";
  size?: "small" | "caret";
}) {
  return (
    <svg
      {...stylex.props(
        styles.icon,
        (kind === "board" ||
          kind === "code" ||
          kind === "pr" ||
          kind === "filter") &&
          styles.rowIcon,
        size === "small" && styles.smallIcon,
        size === "caret" && styles.caretIcon,
      )}
      aria-hidden="true"
      viewBox={
        size === "caret"
          ? "0 0 10 10"
          : kind === "close"
            ? "0 0 12 12"
            : "0 0 16 16"
      }
    >
      {kind === "down" ? (
        <path d="m2.5 4 2.5 2.5L7.5 4" />
      ) : kind === "right" ? (
        <path d="m4 2.5 2.5 2.5L4 7.5" />
      ) : kind === "sort" ? (
        <path d="M5 2v12m-3-3 3 3 3-3M11 14V2m-3 3 3-3 3 3" />
      ) : kind === "close" ? (
        <path d="m3 3 6 6m0-6-6 6" strokeWidth="1.4" />
      ) : kind === "help" ? (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M6.2 6.3Q6.3 4.7 8 4.7Q9.8 4.7 9.8 6.2Q9.8 7.2 8.6 7.7Q8 8 8 8.9M8 11.2h.01" />
        </>
      ) : kind === "settings" ? (
        <>
          <circle cx="8" cy="8" r="2.2" />
          <circle cx="8" cy="8" r="4.6" />
          <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.15 1.15M11.25 11.25l1.15 1.15M3.6 12.4l1.15-1.15M11.25 4.75l1.15-1.15" />
        </>
      ) : kind === "search" ? (
        <>
          <circle cx="7" cy="7" r="4.25" />
          <path d="m10.2 10.2 3.3 3.3" />
        </>
      ) : kind === "filter" ? (
        <path d="M2 4h12M4 8h8M6 12h4" />
      ) : kind === "folder" ? (
        <path d="M2 4.5v7.5h12V6H8l-1.5-1.5z" />
      ) : kind === "branch" ? (
        <>
          <circle cx="4" cy="3" r="1.7" />
          <circle cx="4" cy="13" r="1.7" />
          <circle cx="12" cy="5" r="1.7" />
          <path d="M4 4.7v6.6M12 6.7c0 2.6-4 2.6-8 3.8" />
        </>
      ) : kind === "pr" ? (
        <>
          <circle cx="4" cy="3" r="1.5" />
          <circle cx="4" cy="13" r="1.5" />
          <circle cx="12" cy="13" r="1.5" />
          <path d="M4 4.5v7M12 11.5V7q0-4-5-4m2-2L7 3l2 2" />
        </>
      ) : (
        <>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path
            d={kind === "code" ? "m6 6-2 2 2 2m4-4 2 2-2 2" : "M5 6h6M5 9h4"}
          />
        </>
      )}
    </svg>
  );
}

export function reviewUpdatedAt(review: ReviewApiSummary): string {
  return review.createdAt;
}

export function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
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
