import { BoardIcon, PullRequestStateIcon } from "@canvas/ui/board-icons";
import { CopyableText, copyText } from "@canvas/ui/copy";
import { CrumbSeparator } from "@canvas/ui/crumbs";
import { DisclosureChevron, disclosureStyles } from "@canvas/ui/disclosure";
import { dividerStyles } from "@canvas/ui/divider";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import {
  BranchIcon,
  ChevronDownIcon,
  ClearFiltersIcon,
  CloseIcon,
  CodeIcon,
  FilterIcon,
  FolderIcon,
  GearIcon,
  HelpIcon,
  PlusIcon,
  PullRequestIcon,
  SearchIcon,
  SortIcon,
} from "@canvas/ui/icons";
import { textStyles } from "@canvas/ui/text";
import { fieldStyles } from "@canvas/ui/text-field";
import { useTooltip } from "@canvas/ui/tooltip";
import {
  REVIEW_DISCORD_URL,
  type ReviewApiSummary,
  type ReviewCanvasOnboarding,
  type ReviewRemoteHostActions,
  boardIconKind,
  boardTitle,
  reviewHostStatus,
} from "@dev.fast/review-protocol";
import { fuzzySegments } from "@review/fuzzy-match";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ChangedBadge } from "./changed-badge";
import { useHostActionButton } from "./connection-chip";
import { countLabel, formatRelativeTime } from "./format";
import { homeStyles } from "./home-styles";
import { CanvasUiContext, useCanvasMenu } from "./host/canvas-ui";
import {
  chevronMarker,
  homeGroupMarker,
  homeRowMarker,
} from "./markers.stylex";
import { useNotify } from "./notify";
import { useReviewHostDown } from "./remote-host-state";
import type { ReviewFindHost } from "./review-find";
import {
  HomeFilterPicker,
  type HomeFilterSection,
  filterPickerAnchor,
} from "./review-home-filter-picker";
import {
  type HomeFacet,
  type HomeFilters,
  type HomeGroup,
  type HomeSort,
  activeHomeChips,
  defaultHomeFilters,
  groupFor,
  homeFacetLabels,
  homeFacetValues,
  homeGroups,
  isHomeFacet,
  isUnread,
  matchesHomeFilters,
  mergeChipOrder,
  removeHomeChip,
  reviewMetadataPills,
  sortHomeReviews,
  trashDaysLeft,
  trashRetentionDays,
} from "./review-home-model";
import { styles } from "./review-home-styles";
import { withClass } from "./stylex-props";
import { Button, IconButton } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog } from "./ui/dialog";
import { EmptyState } from "./ui/empty-state";
import { Shortcut } from "./ui/kbd";
import { useDismissOnOutside } from "./ui/popover";
import { StatusBanner } from "./ui/status-banner";
import { surfaceStyles } from "./ui/surface";

interface ReviewHomeProps {
  findHost?: ReviewFindHost;
  view?: "active" | "trash";
  onViewChange?(view: "active" | "trash"): void;
  reviews: readonly ReviewApiSummary[];
  onOpen(review: ReviewApiSummary): void;
  onDelete?(review: ReviewApiSummary): Promise<void>;
  onTrash?(review: ReviewApiSummary): Promise<void>;
  onMarkRead?(review: ReviewApiSummary): Promise<void>;
  onRestore?(review: ReviewApiSummary): Promise<void>;
  remoteHosts?: ReviewRemoteHostActions;
  onboarding?: ReviewCanvasOnboarding;
  onOpenSettings?(): void;
  onOpenSetup?(): void;
  /** Opens New whiteboard; absent where Home cannot draw one. */
  onNewWhiteboard?(): void;
  /** Shown in place of "No whiteboards yet" while there is nothing to list. */
  emptyState?: ReactNode;
}

type PickerTrigger = "filter" | "unread" | HomeFacet;

type Notice = {
  kind: "trash" | "restored" | "permanent";
  targets: ReviewApiSummary[];
};

const collapseKey = "review.home.collapsed.v1";

const visitKey = "review.home.lastVisit.v1";

const week = 7 * 86_400_000;

function readCollapsed(): Record<HomeGroup, boolean> {
  const defaults = { unread: false, week: false, earlier: true };
  const saved = JSON.parse(localStorage.getItem(collapseKey) ?? "{}");

  for (const { id } of homeGroups)
    if (saved?.[id] === true || saved?.[id] === false) defaults[id] = saved[id];

  return defaults;
}

function withEntries<V>(
  map: Map<string, V>,
  entries: Iterable<[string, V]>,
): Map<string, V> {
  const next = new Map(map);

  for (const [key, value] of entries) next.set(key, value);

  return next;
}

export function ReviewHome({
  findHost,
  view,
  onViewChange,
  reviews,
  onOpen,
  onDelete,
  onTrash,
  onMarkRead,
  onRestore,
  remoteHosts,
  onboarding,
  onOpenSettings,
  onOpenSetup,
  onNewWhiteboard,
  emptyState,
}: ReviewHomeProps) {
  const helpTooltip = useTooltip("Help", { instant: true });
  const settingsTooltip = useTooltip("Settings", { instant: true });
  const clearTooltip = useTooltip("Clear filters", { instant: true });
  const filterTooltip = useTooltip("Filter", { instant: true });
  const sortTooltip = useTooltip("Sort", { instant: true });
  const selectGroupTooltip = useTooltip<HTMLInputElement>("Select group");
  const selectTooltip = useTooltip<HTMLInputElement>("Select");
  const ui = useContext(CanvasUiContext);
  const notify = useNotify();

  const [filterState, setFilterState] = useState({
    filters: defaultHomeFilters,
    order: activeHomeChips(defaultHomeFilters),
  });

  const { filters, order: chipOrder } = filterState;

  const setFilters = (update: (filters: HomeFilters) => HomeFilters) =>
    setFilterState((current) => {
      const next = update(current.filters);

      return { filters: next, order: mergeChipOrder(current.order, next) };
    });

  const [query, setQuery] = useState("");
  const [editingSearch, setEditingSearch] = useState<string | null>(null);

  const [picker, setPicker] = useState<{
    trigger: PickerTrigger;
    section: HomeFilterSection;
  } | null>(null);

  const [sort, setSort] = useState<HomeSort>("updated");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [selected, setSelected] = useState(new Set<string>());
  const [deleted, setDeleted] = useState(new Set<string>());
  const [read, setRead] = useState(new Map<string, string>());
  const [lifecycle, setLifecycle] = useState(new Map<string, string | null>());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  // The unavailable review last opened; it opens once its host is back.
  const [waiting, setWaiting] = useState<ReviewApiSummary>();

  useEffect(() => {
    if (!waiting) return;

    const current = reviews.find(
      (review) => review.reviewId === waiting.reviewId,
    );

    if (current && unavailable(current)) return setWaiting(current);
    setWaiting(undefined);

    if (current) onOpen(current);
  }, [reviews]);

  const open = useCallback(
    (review: ReviewApiSummary) => {
      if (unavailable(review)) return setWaiting(review);
      setWaiting(undefined);
      onOpen(review);
    },
    [onOpen],
  );

  const [notice, setNotice] = useState<Notice | null>(null);
  const [localView, setLocalView] = useState<"active" | "trash">("active");
  const inTrash = (view ?? localView) === "trash";
  const published = onboarding?.published || reviews.length > 0;
  const [hasPublished, setHasPublished] = useState(published);

  if (published && !hasPublished) setHasPublished(true);

  const [now, setNow] = useState(Date.now);
  const [lastVisit] = useState(() => Number(localStorage.getItem(visitKey)));
  const [nudgeClosed, setNudgeClosed] = useState(false);
  const [refresherOpen, setRefresherOpen] = useState(false);
  const homeRef = useRef<HTMLElement>(null);
  const filterRegion = useRef<HTMLElement>(null);
  const addFilter = useRef<HTMLButtonElement>(null);
  const chipRow = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const lastSelected = useRef<string | null>(null);
  useDismissOnOutside(filterRegion, picker !== null, () => setPicker(null));

  useEffect(() => {
    localStorage.setItem(visitKey, String(Date.now()));
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);

  const showFind = useEffectEvent((seed?: string) => startTextFilter(seed));

  useEffect(() => {
    findHost?.attach({
      showFind(seed) {
        showFind(seed);

        return true;
      },
      hideFind() {
        input.current?.blur();
      },
    });

    return () => findHost?.attach(null);
  }, [findHost]);

  const describeNotice = useEffectEvent((shown: Notice) => ({
    kind: "success" as const,
    text:
      shown.kind === "trash"
        ? `Moved ${countLabel(shown.targets.length, "whiteboard")} to Trash. You can restore ${shown.targets.length === 1 ? "it" : "them"} for ${trashRetentionDays} days.`
        : `${shown.kind === "permanent" ? "Permanently deleted" : "Restored"} ${countLabel(shown.targets.length, "whiteboard")}.`,
    actions:
      shown.kind === "permanent"
        ? undefined
        : [
            { label: "Undo", run: () => undo(shown) },
            ...(shown.kind === "trash"
              ? [{ label: "View Trash", run: openTrash }]
              : []),
          ],
    onClose: () => setNotice((current) => (current === shown ? null : current)),
  }));

  useEffect(() => {
    if (notice) return notify(describeNotice(notice));
  }, [notice, notify]);

  // Hold successful changes until the catalog acknowledges them; allow later reimports.
  useEffect(() => {
    const ids = new Set(reviews.map((review) => review.reviewId));

    setDeleted((current) => {
      const next = new Set([...current].filter((id) => ids.has(id)));

      return next.size === current.size ? current : next;
    });
    setRead((current) => {
      const next = new Map(
        [...current].filter(([id]) => {
          const review = reviews.find((r) => r.reviewId === id);

          return review && isUnread(review);
        }),
      );

      return next.size === current.size ? current : next;
    });
    setLifecycle((current) => {
      const next = new Map(
        [...current].filter(([id, value]) => {
          const review = reviews.find((r) => r.reviewId === id);

          return review && Boolean(review.trashedAt) !== Boolean(value);
        }),
      );

      return next.size === current.size ? current : next;
    });
  }, [reviews]);

  const catalog = useMemo(
    () =>
      reviews
        .filter((r) => !deleted.has(r.reviewId))
        .map((r) =>
          read.has(r.reviewId) ? { ...r, viewedAt: read.get(r.reviewId)! } : r,
        )
        .map((r) =>
          lifecycle.has(r.reviewId)
            ? { ...r, trashedAt: lifecycle.get(r.reviewId)! }
            : r,
        ),
    [reviews, deleted, read, lifecycle],
  );

  const trashed = catalog.filter((review) => review.trashedAt);

  const listed = catalog.filter(
    (review) => Boolean(review.trashedAt) === inTrash,
  );

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
    chipRow.current?.scrollTo({ left: chipRow.current.scrollWidth });
  }, [renderedChips.length]);

  useLayoutEffect(() => {
    if (
      picker &&
      picker.section !== "all" &&
      !renderedChips.includes(picker.section)
    ) {
      setPicker(null);
      addFilter.current?.focus();
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
    inTrash ? [{ id: "earlier" as const, label: "Trash" }] : homeGroups
  )
    .map((group) => ({
      ...group,
      reviews: inTrash
        ? visible
        : visible.filter((r) => groupFor(r, now) === group.id),
    }))
    .filter((group) => group.reviews.length > 0);

  const ordered = groups.flatMap((group) => group.reviews);
  const selectedReviews = ordered.filter((r) => selected.has(r.reviewId));
  const selectionMode = selectedReviews.length > 0;
  const searching = searchTerms.length > 0;

  const isCollapsed = (id: HomeGroup) =>
    !inTrash && !searching && collapsed[id];

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

  useEffect(() => {
    clearSelection();
    clearFilters();
    setSort(inTrash ? "trash" : "updated");
  }, [inTrash]);

  function startTextFilter(seed = "", id = "") {
    setPicker(null);

    if (editingSearch !== null) finishTextFilter();

    setEditingSearch(id);
    setQuery(seed);
  }

  function openPicker(trigger: PickerTrigger, section: HomeFilterSection) {
    setPicker((current) =>
      current?.trigger === trigger && current.section === section
        ? null
        : { trigger, section },
    );
  }

  function closePicker() {
    const trigger = picker?.trigger;
    setPicker(null);

    if (trigger === "filter") addFilter.current?.focus();
    else
      homeRef.current
        ?.querySelector<HTMLElement>(`[data-home-facet="${trigger}"]`)
        ?.focus();
  }

  function finishTextFilter(discard = false) {
    if (editingSearch === null) return;
    applySearch(editingSearch, discard ? "" : query.trim());
    setEditingSearch(null);
    setQuery("");
  }

  /** Replaces the search chip `previous` (or adds one, for "") with `term`. */
  function applySearch(previous: string, term: string) {
    setFilterState((current) => {
      const searches = current.filters.searches.filter(
        (value) => `search:${value}` !== previous,
      );

      if (term && !searches.includes(term)) searches.push(term);
      const next = { ...current.filters, searches };

      return {
        filters: next,
        order: mergeChipOrder(
          current.order.map((id) => (id === previous ? `search:${term}` : id)),
          next,
        ),
      };
    });
  }

  function clearFilters() {
    setPicker(null);
    setFilters(() => defaultHomeFilters);
    setQuery("");
    setEditingSearch(null);
  }

  function clearSelection() {
    const focused = document.activeElement;

    // Escape makes a mouse-focused checkbox :focus-visible in Chromium; let it hide again.
    if (
      focused instanceof HTMLInputElement &&
      focused.matches('[data-home-row] input[type="checkbox"]')
    )
      focused.blur();

    setSelected(new Set());
  }

  function toggleGroup(id: HomeGroup) {
    if (searching) return;
    setCollapsed((current) => {
      const next = { ...current, [id]: !current[id] };
      localStorage.setItem(collapseKey, JSON.stringify(next));

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

  function showView(next: "active" | "trash") {
    setLocalView(next);
    onViewChange?.(next);
  }

  const openTrash = () => showView("trash");

  /** Runs `action` per target; failures stay selected and are rolled back. */
  async function runBatch(
    targets: ReviewApiSummary[],
    action: (review: ReviewApiSummary) => Promise<void>,
    failure: (count: number) => string,
    rollback: (failed: Set<string>) => void,
  ) {
    busyRef.current = true;
    setBusy(true);
    setError("");
    clearSelection();
    const succeeded: ReviewApiSummary[] = [];
    const failed = new Set<string>();
    const messages: string[] = [];

    for (const review of targets) {
      try {
        await action(review);
        succeeded.push(review);
      } catch (cause) {
        failed.add(review.reviewId);
        messages.push(cause instanceof Error ? cause.message : String(cause));
      }
    }

    if (failed.size) {
      rollback(failed);
      setError(`Could not ${failure(failed.size)}. ${messages.join(" ")}`);
    }

    setSelected(failed);
    busyRef.current = false;
    setBusy(false);

    return { succeeded, failed };
  }

  async function changeLifecycle(
    chosen = selectedReviews,
    restore = false,
    undoing = false,
  ) {
    const action = restore ? onRestore : onTrash;

    if (!action || busyRef.current || !chosen.length) return;

    // Boards other boards need ask first, together, naming their children
    // and the boards that link to them; the host lets the rest through.
    if (
      !restore &&
      !undoing &&
      ui?.confirmDelete &&
      !(await ui.confirmDelete(
        chosen.map((review) => boardTitle(review.title)),
        {
          reviewIds: chosen.map((review) => review.reviewId),
          trash: true,
        },
      ))
    )
      return;

    const targets = chosen;
    const timestamp = restore ? null : new Date().toISOString();

    setLifecycle((current) =>
      withEntries(
        current,
        targets.map((review) => [review.reviewId, timestamp]),
      ),
    );

    const { succeeded, failed } = await runBatch(
      targets,
      action,
      (count) =>
        restore
          ? `restore ${countLabel(count, "whiteboard")}`
          : `move ${countLabel(count, "whiteboard")} to Trash`,
      (failed) =>
        setLifecycle((current) =>
          withEntries(
            current,
            targets
              .filter((review) => failed.has(review.reviewId))
              .map((review) => [review.reviewId, review.trashedAt]),
          ),
        ),
    );

    if (undoing)
      setNotice(
        failed.size
          ? {
              kind: restore ? "trash" : "restored",
              targets: targets.filter((review) => failed.has(review.reviewId)),
            }
          : null,
      );
    else if (succeeded.length)
      setNotice({ kind: restore ? "restored" : "trash", targets: succeeded });
  }

  async function deletePermanently(targets: ReviewApiSummary[]) {
    if (
      !onDelete ||
      busyRef.current ||
      !(await ui?.confirmDelete?.(
        targets.map((review) => boardTitle(review.title)),
        {
          reviewIds: targets.map((review) => review.reviewId),
        },
      ))
    )
      return;

    setDeleted(
      (current) => new Set([...current, ...targets.map((r) => r.reviewId)]),
    );

    const { succeeded } = await runBatch(
      targets,
      onDelete,
      (count) => `permanently delete ${countLabel(count, "whiteboard")}`,
      (failed) =>
        setDeleted(
          (current) => new Set([...current].filter((id) => !failed.has(id))),
        ),
    );

    if (succeeded.length) setNotice({ kind: "permanent", targets: succeeded });
  }

  async function markRead(targets: ReviewApiSummary[]) {
    if (!onMarkRead || busyRef.current || !targets.length) return;
    const timestamp = new Date().toISOString();

    setRead((current) =>
      withEntries(
        current,
        targets.map((review) => [review.reviewId, timestamp]),
      ),
    );

    await runBatch(
      targets,
      onMarkRead,
      (count) => `mark ${countLabel(count, "whiteboard")} read`,
      (failed) =>
        setRead(
          (current) => new Map([...current].filter(([id]) => !failed.has(id))),
        ),
    );
  }

  function undo(shown: Notice) {
    if (shown.kind !== "permanent")
      void changeLifecycle(shown.targets, shown.kind === "trash", true);
  }

  function deleteSelection(targets = selectedReviews) {
    if (!targets.length) return;

    if (inTrash) void deletePermanently([...targets]);
    else void changeLifecycle(targets);
  }

  const keydown = useEffectEvent((event: KeyboardEvent) => {
    // An open menu owns keyboard input until it closes; its Escape must not
    // also clear the selection below it.
    if (
      event.defaultPrevented ||
      refresherOpen ||
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
      notice &&
      notice.kind !== "permanent" &&
      !busyRef.current
    ) {
      event.preventDefault();
      event.stopPropagation();
      undo(notice);
    } else if (!editing && !command && !event.altKey && key === "f") {
      event.preventDefault();
      openPicker("filter", "all");
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
    } else if (
      !editing &&
      selectionMode &&
      !event.repeat &&
      inTrash &&
      !command &&
      !event.altKey &&
      key === "r"
    ) {
      event.preventDefault();
      void changeLifecycle(selectedReviews, true);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keydown(event);
    window.addEventListener("keydown", listener, true);

    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  const filterCount = activeHomeChips(filters).filter(
    (id) => !id.startsWith("search:"),
  ).length;

  const hidden = listed.length - visible.length;

  const cause = [
    searching ? `“${searchTerms.join("” and “")}”` : "",
    filterCount ? countLabel(filterCount, "filter") : "",
  ]
    .filter(Boolean)
    .join(" and ");

  const completed = onboarding
    ? Number(onboarding.installed) + Number(onboarding.published)
    : 2;

  // Nothing to list, nor filtered away: Home offers to draw one in place.
  const drawInPlace =
    emptyState !== undefined && !inTrash && listed.length === 0;

  // Drawing in place is the next step itself, so the banner would repeat it.
  const setupIncomplete =
    !inTrash &&
    !hasPublished &&
    completed < 2 &&
    !(drawInPlace && onboarding?.installed);

  const weeksAway = lastVisit > 0 ? Math.floor((now - lastVisit) / week) : 0;

  const sortOptions = [
    ...(inTrash ? [{ value: "trash" as const, label: "Trashed" }] : []),
    { value: "updated" as const, label: "Updated" },
    { value: "created" as const, label: "Created" },
    { value: "title" as const, label: "Title" },
  ];

  const anchored = (trigger: PickerTrigger) =>
    picker?.trigger === trigger && filterPickerAnchor.anchor;

  const sortMenu = useCanvasMenu({
    items: sortOptions.map((option) => ({
      id: option.value,
      label: option.label,
      checked: option.value === sort,
    })),
    onSelect: (id) => {
      const option = sortOptions.find((item) => item.value === id);

      if (option) setSort(option.value);
    },
  });

  const helpMenu = useCanvasMenu({
    items: [
      { id: "discord", label: "Ask on Discord ↗" },
      { id: "email", label: "Need help? Copy our email" },
    ],
    onSelect: async (id) => {
      if (id === "discord")
        window.open(REVIEW_DISCORD_URL, "_blank", "noopener,noreferrer");
      else if (id === "email") {
        const copied = await copyText("founders@dev.fast");

        notify(
          copied
            ? {
                kind: "success",
                text: "Copied 'founders@dev.fast' to clipboard",
              }
            : { kind: "error", text: "Couldn't copy email. Please try again." },
        );
      }
    },
  });

  const renderChip = (id: string) => {
    if (id === "draft" || id === editingSearch) {
      return (
        <span key={id} {...stylex.props(styles.chip, styles.editingChip)}>
          <SearchIcon xstyle={[iconStyles.inline, styles.editingIcon]} />
          <input
            ref={input}
            aria-label="Search whiteboards"
            role="searchbox"
            spellCheck={false}
            value={query}
            {...stylex.props(
              fieldStyles.bare,
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
            {...stylex.props(styles.faint)}
          >
            {visible.length}
          </span>
        </span>
      );
    }

    if (id.startsWith("search:")) {
      const term = id.slice("search:".length);

      return (
        <FilterChip
          key={id}
          label={term}
          onOpen={() => startTextFilter(term, id)}
          onRemove={() => setFilters((current) => removeHomeChip(current, id))}
        >
          <SearchIcon xstyle={[iconStyles.inline, styles.muted]} />
          <span {...stylex.props(styles.chipValue)}>{term}</span>
        </FilterChip>
      );
    }

    const facet = isHomeFacet(id) ? id : null;
    const values = facet ? homeFacetValues(filters, facet, listed) : [];
    const name = facet && homeFacetLabels[facet];

    const label = facet
      ? `${name} ${values.length > 1 ? `${values[0]} +${values.length - 1}` : values[0]}`
      : "Unread only";

    return (
      <FilterChip
        key={id}
        label={label}
        tooltip={values.length ? values.join("\n") : undefined}
        facet={id}
        open={picker?.section === id}
        xstyle={anchored(facet ?? "unread")}
        onOpen={() => openPicker(facet ?? "unread", facet ?? "unread")}
        onRemove={() => setFilters((current) => removeHomeChip(current, id))}
      >
        {facet ? (
          <>
            <span {...stylex.props(styles.muted)}>{name}</span>
            <span {...stylex.props(styles.chipValue)}>{values[0]}</span>
            {values.length > 1 && (
              <span {...stylex.props(styles.muted)}>+{values.length - 1}</span>
            )}
          </>
        ) : (
          <span {...stylex.props(styles.chipValue)}>{label}</span>
        )}
      </FilterChip>
    );
  };

  return (
    <main ref={homeRef} {...withClass("review-home", homeStyles.page)}>
      <div
        data-home-scroll
        {...stylex.props(
          homeStyles.scroll,
          styles.scroll,
          selectionMode && styles.selectionSpace,
          drawInPlace && styles.fillScroll,
        )}
      >
        <div
          {...stylex.props(
            homeStyles.content,
            styles.content,
            drawInPlace && styles.fillContent,
          )}
        >
          <header
            ref={filterRegion}
            {...stylex.props(homeStyles.header, styles.header)}
          >
            {inTrash ? (
              <h1 {...stylex.props(homeStyles.heading, styles.trail)}>
                <Button variant="link" onClick={() => showView("active")}>
                  Whiteboards
                </Button>
                <CrumbSeparator xstyle={styles.trailChevron} />
                Trash
                <span {...stylex.props(styles.faint)}>{trashed.length}</span>
              </h1>
            ) : (
              <h1 {...stylex.props(homeStyles.heading)}>Whiteboards</h1>
            )}
            {renderedChips.length > 0 && (
              <div
                ref={chipRow}
                aria-label="Active filters"
                {...stylex.props(styles.chips)}
              >
                {renderedChips.map(renderChip)}
              </div>
            )}
            <div {...stylex.props(styles.controls, styles.headerControls)}>
              {renderedChips.length > 0 && (
                <IconButton
                  aria-label="Clear filters"
                  size="large"
                  ref={clearTooltip}
                  onClick={clearFilters}
                >
                  <ClearFiltersIcon />
                </IconButton>
              )}
              <IconButton
                aria-label="Add filters"
                size="large"
                ref={(element) => {
                  addFilter.current = element;
                  filterTooltip(element);
                }}
                aria-haspopup="dialog"
                aria-expanded={picker?.trigger === "filter"}
                xstyle={anchored("filter")}
                onClick={() => openPicker("filter", "all")}
              >
                <FilterIcon />
              </IconButton>
              <Button
                variant="ghost"
                aria-label="Sort whiteboards"
                ref={sortTooltip}
                {...sortMenu.triggerProps}
              >
                <SortIcon />
                {sortOptions.find((option) => option.value === sort)?.label}
                <ChevronDownIcon />
              </Button>
              {onNewWhiteboard && !inTrash && !drawInPlace ? (
                <Button
                  variant="primary"
                  xstyle={styles.newWhiteboard}
                  onClick={onNewWhiteboard}
                >
                  <PlusIcon />
                  New
                </Button>
              ) : null}
            </div>
            {picker !== null && (
              <HomeFilterPicker
                key={picker.section}
                alignment={picker.trigger === "filter" ? "end" : "start"}
                section={picker.section}
                reviews={listed}
                filters={appliedFilters}
                query={query}
                onChange={setFilters}
                onSearch={(term) => {
                  setPicker(null);
                  applySearch("", term);
                }}
                count={visible.length}
                onClose={closePicker}
              />
            )}
          </header>
          {inTrash && (
            <p {...stylex.props(styles.muted, styles.retentionNote)}>
              Trash is deleted after {trashRetentionDays} days.
            </p>
          )}
          {setupIncomplete ? (
            <StatusBanner
              xstyle={styles.notice}
              action={
                <Button size="large" onClick={onOpenSetup}>
                  Continue setup
                </Button>
              }
            >
              Finish setting up Whiteboard · {completed} of 2 done · next:{" "}
              {!onboarding?.installed
                ? "connect your agent"
                : "create your first whiteboard"}
            </StatusBanner>
          ) : !inTrash && weeksAway >= 2 && !nudgeClosed ? (
            <StatusBanner
              xstyle={styles.notice}
              action={
                <>
                  <Button size="large" onClick={() => setRefresherOpen(true)}>
                    Refresh me
                  </Button>
                  <IconButton
                    aria-label="Close welcome back"
                    onClick={() => setNudgeClosed(true)}
                  >
                    <CloseIcon />
                  </IconButton>
                </>
              }
            >
              Welcome back. It’s been {weeksAway} weeks — boards, lenses and Ask
              in a 3-minute refresher.
            </StatusBanner>
          ) : null}
          {error && <p role="alert">{error}</p>}
          {waiting ? <HostNotice review={waiting} hosts={remoteHosts} /> : null}
          {drawInPlace
            ? emptyState
            : !visible.length && (
                <EmptyState
                  message={
                    hidden
                      ? "No matching whiteboards."
                      : inTrash
                        ? "Trash is empty."
                        : "No whiteboards yet."
                  }
                />
              )}
          <div {...stylex.props(styles.list)}>
            {groups.map((group) => {
              const count = group.reviews.filter((r) =>
                selected.has(r.reviewId),
              ).length;

              const isSelected = (index: number) =>
                selected.has(group.reviews[index]?.reviewId);

              return (
                <section
                  key={group.id}
                  aria-label={group.label}
                  {...stylex.props(homeGroupMarker, styles.group)}
                >
                  {!inTrash && (
                    <div {...stylex.props(styles.groupHeader)}>
                      <button
                        type="button"
                        aria-expanded={!isCollapsed(group.id)}
                        {...stylex.props(
                          chevronMarker,
                          disclosureStyles.toggle,
                          focusStyles.ring,
                          styles.groupToggle,
                        )}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <DisclosureChevron />
                        <span {...stylex.props(styles.slot)}>
                          {group.id === "unread" && (
                            <span {...stylex.props(styles.dot)} />
                          )}
                        </span>
                        <span>{group.label}</span>
                        <span {...stylex.props(styles.faint, styles.regular)}>
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
                        <Checkbox
                          ref={selectGroupTooltip}
                          aria-label={`Select ${group.label}`}
                          checked={count === group.reviews.length}
                          indeterminate={
                            count > 0 && count < group.reviews.length
                          }
                          xstyle={count === 0 && styles.hiddenGroupCheck}
                          onChange={() => selectGroup(group.reviews)}
                        />
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
                          styles.waterfall(index),
                          unavailable(review) && styles.unavailableRow,
                          isSelected(index) && styles.selected,
                          isSelected(index) &&
                            isSelected(index - 1) &&
                            styles.selectedAfter,
                          isSelected(index) &&
                            isSelected(index + 1) &&
                            styles.selectedBefore,
                        )}
                        data-unavailable={unavailable(review) ? "" : undefined}
                        onClick={() =>
                          inTrash ? toggleRow(review.reviewId) : open(review)
                        }
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
                        <Checkbox
                          ref={selectTooltip}
                          aria-label={`Select ${boardTitle(review.title)}`}
                          checked={isSelected(index)}
                          xstyle={!isSelected(index) && styles.hiddenCheck}
                          onChange={() => {}}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleRow(review.reviewId, event.shiftKey);
                          }}
                        />
                        {/* A PR's state, else the board's target. */}
                        <span {...stylex.props(styles.kindIcon)}>
                          {review.origin?.pullRequestNumber ? (
                            <PullRequestStateIcon
                              number={review.origin.pullRequestNumber}
                              state={review.pullRequestState}
                            />
                          ) : (
                            <BoardIcon icon={boardIconKind(review.target)} />
                          )}
                          {review.changed ? <ChangedBadge /> : null}
                        </span>
                        <button
                          type="button"
                          aria-label={`${inTrash ? "Select" : "Open"} ${boardTitle(review.title)}`}
                          aria-disabled={unavailable(review) || undefined}
                          {...stylex.props(styles.rowOpen)}
                          onClick={(event) => {
                            event.stopPropagation();

                            if (inTrash) toggleRow(review.reviewId);
                            else open(review);
                          }}
                        >
                          <span
                            title={
                              unavailable(review)
                                ? hostStatus(review).label
                                : boardTitle(review.title)
                            }
                            {...stylex.props(
                              textStyles.truncate,
                              styles.title,
                              inTrash && styles.muted,
                            )}
                          >
                            <MatchedText
                              text={boardTitle(review.title)}
                              queries={searchTerms}
                            />
                          </span>
                        </button>
                        <span {...stylex.props(styles.metadata)}>
                          {reviewMetadataPills(review, appliedFilters)
                            .filter(
                              (pill) => !inTrash || pill.facet !== "branches",
                            )
                            .map((pill) =>
                              pill.facet === "pullRequest" ? (
                                <PullRequestPill
                                  key={pill.facet}
                                  url={pill.key}
                                  label={pill.label}
                                  title={pill.title}
                                  queries={searchTerms}
                                />
                              ) : (
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
                                  {pill.facet === "branches" ? (
                                    <>
                                      <BranchIcon xstyle={iconStyles.inline} />
                                      <MiddleTruncatedText
                                        text={pill.label}
                                        queries={searchTerms}
                                      />
                                    </>
                                  ) : (
                                    <>
                                      <FolderIcon xstyle={iconStyles.inline} />
                                      <span {...stylex.props(styles.ellipsis)}>
                                        <MatchedText
                                          text={pill.label}
                                          queries={searchTerms}
                                        />
                                      </span>
                                    </>
                                  )}
                                </button>
                              ),
                            )}
                        </span>
                        <RowTime review={review} now={now} inTrash={inTrash} />
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
          {hidden > 0 && (
            <footer {...stylex.props(styles.footer)}>
              <div>
                {countLabel(hidden, "whiteboard")} hidden by {cause} ·{" "}
                <Button variant="ghost" onClick={clearFilters}>
                  Clear filters
                  <CloseIcon xstyle={iconStyles.inline} />
                </Button>
              </div>
            </footer>
          )}
          {!inTrash && trashed.length > 0 && (
            <footer {...stylex.props(styles.footer)}>
              <Button variant="ghost" onClick={openTrash}>
                {trashed.length} in Trash ›
              </Button>
            </footer>
          )}
        </div>
      </div>
      {!inTrash && (
        <div {...stylex.props(styles.controls, styles.corner)}>
          <IconButton
            aria-label="Help"
            size="large"
            xstyle={styles.cornerButton}
            ref={helpTooltip}
            {...helpMenu.triggerProps}
          >
            <HelpIcon xstyle={styles.cornerIcon} />
          </IconButton>
          <IconButton
            aria-label="Settings"
            size="large"
            xstyle={styles.cornerButton}
            ref={settingsTooltip}
            disabled={!onOpenSettings}
            onClick={onOpenSettings}
          >
            <GearIcon xstyle={styles.cornerIcon} />
          </IconButton>
        </div>
      )}
      {selectionMode && (
        <div
          role="toolbar"
          aria-label="Selected whiteboards"
          {...stylex.props(surfaceStyles.popover, styles.bar)}
        >
          <span {...stylex.props(styles.barCount)}>
            {selectedReviews.length} selected
          </span>
          {inTrash && (
            <Button
              variant="ghost"
              disabled={busy || !onRestore}
              onClick={() => void changeLifecycle(selectedReviews, true)}
            >
              Restore <Shortcut>R</Shortcut>
            </Button>
          )}
          {!inTrash && selectedReviews.some(isUnread) && (
            <Button
              variant="ghost"
              disabled={busy || !onMarkRead}
              onClick={() => void markRead(selectedReviews.filter(isUnread))}
            >
              Mark Read
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy || !(inTrash ? onDelete : onTrash)}
            xstyle={styles.danger}
            onClick={() => deleteSelection()}
          >
            {inTrash ? "Delete…" : "Trash"} <Shortcut>⌘⌫</Shortcut>
          </Button>
          <span
            aria-hidden="true"
            {...stylex.props(dividerStyles.vertical, styles.barDivider)}
          />
          <IconButton aria-label="Clear selection" onClick={clearSelection}>
            <CloseIcon />
          </IconButton>
        </div>
      )}
      {refresherOpen && (
        <Dialog
          aria-labelledby="home-help-title"
          xstyle={styles.dialog}
          onClose={() => setRefresherOpen(false)}
        >
          <div {...stylex.props(styles.header)}>
            <h2 id="home-help-title" {...stylex.props(styles.dialogTitle)}>
              How Whiteboard works
            </h2>
            <IconButton
              aria-label="Close help"
              onClick={() => setRefresherOpen(false)}
            >
              <CloseIcon />
            </IconButton>
          </div>
          <p>A 3-minute refresher</p>
          <h3>Boards hold the work</h3>
          <p>
            Your agent publishes a whiteboard to explain a change, explore a
            design, or share a plan. Open a board to read it alongside its code
            and diagrams. Home collects those boards across your repositories.
          </p>
          <h3>Lenses give you a path</h3>
          <p>
            A lens focuses the board on a particular question. Follow its steps
            to move between explanations, source, and diagrams without losing
            your place.
          </p>
          <h3>Ask where you are</h3>
          <p>
            Select the part you want to understand and use Ask to discuss it
            with your agent. Keep the conversation beside the work, then follow
            the agent’s updates on the board.
          </p>
          <h3>Find your way back</h3>
          <p>
            Unread contains new boards and updates since your last visit to a
            board. Search titles, worktrees, branches or repositories, or add
            filters with the filter icon; Sort orders each group. Delete keeps
            completed work out of the way until you need it again.
          </p>
        </Dialog>
      )}
    </main>
  );
}

function FilterChip({
  label,
  tooltip,
  facet,
  open = false,
  xstyle,
  onOpen,
  onRemove,
  children,
}: {
  label: string;
  tooltip?: string;
  facet?: string;
  open?: boolean;
  xstyle?: stylex.StyleXStyles | false;
  onOpen(): void;
  onRemove(): void;
  children: ReactNode;
}) {
  const tip = useTooltip(tooltip ?? label, { detail: "Click to edit" });

  return (
    <span {...stylex.props(styles.chip, open && styles.chipOpen)}>
      <button
        type="button"
        ref={tip}
        data-home-facet={facet}
        aria-haspopup={facet ? "dialog" : undefined}
        aria-expanded={facet ? open : undefined}
        aria-label={label}
        {...stylex.props(styles.chipText, xstyle)}
        onClick={onOpen}
      >
        {children}
      </button>
      <IconButton
        aria-label={`Remove ${label}`}
        xstyle={styles.chipClose}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
      >
        <CloseIcon xstyle={iconStyles.inline} />
      </IconButton>
    </span>
  );
}

function RowTime({
  review,
  now,
  inTrash,
}: {
  review: ReviewApiSummary;
  now: number;
  inTrash: boolean;
}) {
  if (unavailable(review))
    return (
      <span title={review.createdAt} {...stylex.props(styles.time)}>
        {hostStatus(review).status}
      </span>
    );

  if (review.working)
    return (
      <span
        title="Agent writing"
        {...stylex.props(styles.time, styles.writing)}
      >
        <span aria-hidden="true" {...stylex.props(styles.writingDot)} />
        writing
      </span>
    );

  if (inTrash) {
    const days = trashDaysLeft(review, now);

    return (
      <span
        title={review.trashedAt!}
        {...stylex.props(styles.time, days < 3 && styles.expiring)}
      >
        {days} days left
      </span>
    );
  }

  return (
    <span title={review.createdAt} {...stylex.props(styles.time)}>
      {formatRelativeTime(review.createdAt, now)}
    </span>
  );
}

function unavailable(review: ReviewApiSummary): boolean {
  return review.hostState !== undefined && review.hostState !== "online";
}

function hostStatus(review: ReviewApiSummary) {
  return reviewHostStatus({
    alias: review.host ?? "",
    state: review.hostState ?? "online",
  });
}

function HostNotice({
  review,
  hosts,
}: {
  review: ReviewApiSummary;
  hosts?: ReviewRemoteHostActions;
}) {
  const status = useReviewHostDown({ ...review, hosts });

  const { failure, button } = useHostActionButton(
    hosts,
    review.host,
    status?.action,
  );

  if (!status) return null;

  return (
    <p role="alert" {...stylex.props(styles.hostNotice)}>
      <CopyableText text={failure ?? status.sentence} />
      {button}
    </p>
  );
}

function PullRequestPill({
  url,
  label,
  title,
  queries,
}: {
  url: string;
  label: string;
  title?: string;
  queries: string[];
}) {
  const tooltip = useTooltip<HTMLAnchorElement>(
    title ? `${label} ${title}` : label,
    { quick: true },
  );

  return (
    <a
      ref={tooltip}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      {...stylex.props(styles.metadataPill)}
      onClick={(event) => event.stopPropagation()}
    >
      <PullRequestIcon xstyle={iconStyles.inline} />
      {label}
      {title && (
        <span {...stylex.props(styles.ellipsis, styles.pullRequestTitle)}>
          <MatchedText text={title} queries={queries} />
        </span>
      )}
    </a>
  );
}

function MiddleTruncatedText({
  text,
  queries,
}: {
  text: string;
  queries: string[];
}) {
  // The prefix elides first so the branch keeps its last path component.
  const split = text.includes("/")
    ? text.lastIndexOf("/") + 1
    : Math.ceil(text.length * 0.75);

  return (
    <span {...stylex.props(styles.middle)}>
      <span {...stylex.props(styles.ellipsis)}>
        <MatchedText text={text} queries={queries} to={split} />
      </span>
      <span {...stylex.props(styles.middleSuffix)}>
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

  const segments: ReactNode[] = [];

  for (let start = from; start < to; ) {
    let end = start + 1;

    while (end < to && matched.has(end) === matched.has(start)) end++;
    const part = text.slice(start, end);

    segments.push(
      matched.has(start) ? (
        <mark key={start} {...stylex.props(styles.mark)}>
          {part}
        </mark>
      ) : (
        part
      ),
    );
    start = end;
  }

  return segments;
}
