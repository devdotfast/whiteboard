import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { fuzzyMatches } from "@review/fuzzy-match";
import * as stylex from "@stylexjs/stylex";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { countLabel } from "./format";
import { filterRowMarker } from "./markers.stylex";
import {
  type HomeFacet,
  type HomeFilters,
  type HomeRepository,
  homeFacetLabels,
  homeRepositories,
  isHomeFacet,
  matchesHomeFilters,
  toggleHomeRepository,
  toggleHomeWorktree,
} from "./review-home-model";
import { fontSize, space } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { CheckboxMark } from "./ui/checkbox";
import { Shortcut } from "./ui/kbd";
import { menuStyles, moveMenuFocus } from "./ui/menu";
import { surfaceStyles } from "./ui/surface";
import { textStyles } from "./ui/text";
import { fieldStyles } from "./ui/text-field";

export type HomeFilterSection = "all" | "unread" | HomeFacet;

type Tree = HomeRepository["trees"][number];

type Choice = { checked: boolean | "mixed"; count?: string; show: boolean };

const rows = "[data-picker-row]";

export const filterPickerAnchor = stylex.create({
  anchor: { anchorName: "--home-filter" },
});

export function HomeFilterPicker({
  alignment,
  section,
  reviews,
  filters,
  query,
  count,
  onChange,
  onSearch,
  onClose,
}: {
  alignment: "start" | "end";
  section: HomeFilterSection;
  reviews: ReviewApiSummary[];
  filters: HomeFilters;
  query: string;
  count: number;
  onChange(update: (filters: HomeFilters) => HomeFilters): void;
  onSearch(term: string): void;
  onClose(): void;
}) {
  const main = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLDivElement>(null);
  const mainInput = useRef<HTMLInputElement>(null);
  const subInput = useRef<HTMLInputElement>(null);
  const parentRow = useRef<HTMLButtonElement | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const focusSubmenu = useRef(false);
  const [search, setSearch] = useState("");
  const [subSearch, setSubSearch] = useState("");
  const [repository, setRepository] = useState<string | null>(null);
  const scoped = section !== "all";
  const facetName = isHomeFacet(section) ? homeFacetLabels[section] : "Show";
  const repositories = useMemo(() => homeRepositories(reviews), [reviews]);
  const activeRepo = repositories.find((repo) => repo.key === repository);

  const total = (next: HomeFilters) =>
    reviews.filter((review) => matchesHomeFilters(review, next, query)).length;

  function choice(
    checked: boolean | "mixed",
    own: HomeFilters,
    next: HomeFilters,
  ): Choice {
    const ownCount = total(own);
    const nextCount = total(next);

    const sibling =
      filters.worktrees.length > 0 || filters.repositories.length > 0;

    const added = nextCount - count;

    return {
      checked,
      count:
        !checked && sibling
          ? `+${added}`
          : String(checked ? ownCount : nextCount),
      show: Boolean(checked) || (ownCount > 0 && (!sibling || added > 0)),
    };
  }

  function treeChoice(tree: Tree): Choice {
    const repo = repositories.find((repo) => repo.trees.includes(tree));

    return choice(
      filters.worktrees.includes(tree.key) ||
        Boolean(repo && filters.repositories.includes(repo.key)),
      { ...filters, repositories: [], worktrees: [tree.key] },
      { ...filters, worktrees: [...filters.worktrees, tree.key] },
    );
  }

  function repoChoice(repo: HomeRepository): Choice {
    const trees = repo.trees.map((tree) => tree.key);

    const checked =
      Boolean(repo.key) && filters.repositories.includes(repo.key)
        ? true
        : trees.some((key) => filters.worktrees.includes(key))
          ? "mixed"
          : false;

    return choice(
      checked,
      {
        ...filters,
        repositories: repo.key ? [repo.key] : [],
        worktrees: repo.key ? [] : trees,
      },
      repo.key
        ? { ...filters, repositories: [...filters.repositories, repo.key] }
        : {
            ...filters,
            worktrees: [...new Set([...filters.worktrees, ...trees])],
          },
    );
  }

  const cancelPending = () => {
    clearTimeout(pending.current);
    pending.current = undefined;
  };

  function openSubmenu(
    repo: HomeRepository,
    row: HTMLButtonElement,
    moveFocus: boolean,
  ) {
    cancelPending();
    parentRow.current = row;
    focusSubmenu.current = moveFocus;

    if (repository !== repo.key) setSubSearch("");
    setRepository(repo.key);

    if (repository === repo.key && moveFocus)
      subInput.current?.focus({ preventScroll: true });
  }

  function hoverRepository(repo: HomeRepository, row: HTMLButtonElement) {
    cancelPending();

    if (repository === repo.key) return;
    // Diagonal motion toward the submenu keeps resetting this intent timer.
    pending.current = setTimeout(() => openSubmenu(repo, row, false), 100);
  }

  function closeSubmenu(focus: HTMLElement | null | undefined) {
    cancelPending();
    setRepository(null);
    focus?.focus();
  }

  useLayoutEffect(() => {
    main.current?.showPopover?.();
    mainInput.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (repository === null) return;
    sub.current?.showPopover?.();

    // Hover keeps the caret in the parent; keyboard explicitly enters.
    if (focusSubmenu.current) subInput.current?.focus({ preventScroll: true });
    focusSubmenu.current = false;
  }, [repository]);

  // Escape backs out of the submenu first, wherever focus is.
  const escape = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();

      if (repository !== null) closeSubmenu(mainInput.current);
      else onClose();
    } else if (
      event.key === "ArrowLeft" &&
      event.target instanceof Node &&
      sub.current?.contains(event.target)
    ) {
      event.preventDefault();
      closeSubmenu(parentRow.current);
    }
  });

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => escape(event);
    window.addEventListener("keydown", listener, true);

    return () => {
      window.removeEventListener("keydown", listener, true);
      cancelPending();
    };
  }, []);

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp")
      moveMenuFocus(event, rows);
  };

  function focusUnderPointer(
    event: PointerEvent,
    input: HTMLInputElement | null,
  ) {
    if (event.pointerType === "mouse" && document.activeElement !== input)
      input?.focus({ preventScroll: true });
  }

  const toggleTree = (tree: Tree) =>
    onChange((current) => toggleHomeWorktree(current, tree.key, repositories));

  const treeRow = (tree: Tree, label = tree.label) => (
    <PickerRow
      key={tree.key}
      label={label}
      {...treeChoice(tree)}
      onClick={() => toggleTree(tree)}
    />
  );

  const repoRow = (repo: HomeRepository) => {
    // A repository with one worktree toggles directly.
    const nested = repo.trees.length > 1;

    return (
      <PickerRow
        key={repo.key}
        label={repo.label}
        {...repoChoice(repo)}
        expanded={repository === repo.key}
        onClick={() =>
          onChange((current) =>
            toggleHomeRepository(current, repo, repositories),
          )
        }
        onHover={nested ? (row) => hoverRepository(repo, row) : undefined}
        onLeave={cancelPending}
        onRight={nested ? (row) => openSubmenu(repo, row, true) : undefined}
      />
    );
  };

  const unreadCount = total({ ...filters, unread: true });

  const unreadRow =
    fuzzyMatches(search, "Unread only") &&
    (filters.unread || unreadCount > 0) ? (
      <PickerRow
        key="unread"
        label="Unread only"
        checked={filters.unread}
        count={String(unreadCount)}
        onClick={() =>
          onChange((current) => ({ ...current, unread: !current.unread }))
        }
      />
    ) : null;

  const repoRows = repositories.filter(
    (repo) => repoChoice(repo).show && fuzzyMatches(search, repo.label),
  );

  const treeRows = search
    ? repositories.flatMap((repo) =>
        repo.trees
          .filter(
            (tree) => treeChoice(tree).show && fuzzyMatches(search, tree.label),
          )
          .map((tree) => treeRow(tree, `${repo.label} › ${tree.label}`)),
      )
    : [];

  function facetRows(): {
    key: string;
    checked: boolean | "mixed";
    node: ReactNode;
  }[] {
    if (section === "branches")
      return [
        ...new Set(reviews.flatMap((review) => review.origin?.branch || [])),
      ]
        .sort((a, b) => a.localeCompare(b))
        .filter((branch) => fuzzyMatches(search, branch))
        .map((branch) => ({
          key: branch,
          checked: filters.branches.includes(branch),
          n: total({ ...filters, branches: [branch] }),
        }))
        .filter((row) => row.checked || row.n > 0)
        .map(({ key, checked, n }) => ({
          key,
          checked,
          node: (
            <PickerRow
              key={key}
              label={key}
              checked={checked}
              count={String(n)}
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  branches: current.branches.includes(key)
                    ? current.branches.filter((value) => value !== key)
                    : [...current.branches, key],
                }))
              }
            />
          ),
        }));

    if (section === "worktrees")
      return repositories
        .flatMap((repo) => repo.trees)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((tree) => ({ tree, state: treeChoice(tree) }))
        .filter(
          ({ tree, state }) => state.show && fuzzyMatches(search, tree.label),
        )
        .map(({ tree, state }) => ({
          key: tree.key,
          checked: state.checked,
          node: treeRow(tree),
        }));

    if (section === "repositories")
      return repoRows.map((repo) => ({
        key: repo.key,
        checked: repoChoice(repo).checked,
        node: repoRow(repo),
      }));

    return unreadRow
      ? [{ key: "unread", checked: filters.unread, node: unreadRow }]
      : [];
  }

  function scopedBody() {
    const all = facetRows();
    const order = isHomeFacet(section) ? filters[section] : [];

    const selected = all
      .filter((row) => row.checked !== false)
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

    const rest = all.filter((row) => row.checked === false);

    return (
      <>
        {selected.map((row) => row.node)}
        {selected.length > 0 && rest.length > 0 && (
          <div role="separator" {...stylex.props(styles.divider)} />
        )}
        {rest.map((row) => row.node)}
        {all.length === 0 && <Empty />}
      </>
    );
  }

  return (
    <>
      <div
        ref={main}
        popover="manual"
        role="dialog"
        aria-label={scoped ? `${facetName} filters` : "Add filters"}
        tabIndex={-1}
        data-home-picker
        {...stylex.props(
          surfaceStyles.popover,
          menuStyles.popover,
          alignment === "end" && menuStyles.end,
          styles.popup,
        )}
        onPointerEnter={(event) => focusUnderPointer(event, mainInput.current)}
        onPointerMove={(event) => focusUnderPointer(event, mainInput.current)}
        onKeyDown={navigate}
      >
        <input
          ref={mainInput}
          aria-label={scoped ? facetName : "Filter options"}
          placeholder={scoped ? facetName : "Filter…"}
          value={search}
          {...stylex.props(fieldStyles.bare, styles.filter)}
          onChange={(event) => {
            setSearch(event.target.value);
            setRepository(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !scoped && search.trim())
              onSearch(search.trim());
          }}
        />
        <div {...stylex.props(styles.body)}>
          {scoped ? (
            scopedBody()
          ) : (
            <>
              <div {...stylex.props(styles.hint)}>
                <Shortcut>enter</Shortcut> to keyword filter
              </div>
              {unreadRow && (
                <section aria-label="Show filters">
                  <Label>Show</Label>
                  {unreadRow}
                </section>
              )}
              {(repoRows.length > 0 || treeRows.length > 0) && (
                <section aria-label="Repository filters">
                  <Label>Repository</Label>
                  {repoRows.map(repoRow)}
                  {treeRows}
                </section>
              )}
              {!unreadRow && !repoRows.length && !treeRows.length && <Empty />}
            </>
          )}
        </div>
        <div {...stylex.props(styles.footer)}>
          <span>Showing {countLabel(count, "board")}</span>
          <span {...stylex.props(styles.faint)}>
            <Shortcut>esc</Shortcut> done
          </span>
        </div>
      </div>
      {activeRepo && (
        <div
          ref={sub}
          popover="manual"
          role="dialog"
          aria-label={`${activeRepo.label} worktrees`}
          tabIndex={-1}
          data-home-submenu
          {...stylex.props(
            surfaceStyles.popover,
            menuStyles.popover,
            styles.submenu,
            alignment === "end" && styles.submenuStart,
          )}
          onPointerEnter={(event) => {
            cancelPending();
            focusUnderPointer(event, subInput.current);
          }}
          onPointerMove={(event) => {
            cancelPending();
            focusUnderPointer(event, subInput.current);
          }}
          onKeyDown={navigate}
        >
          <input
            ref={subInput}
            aria-label="Filter worktrees"
            placeholder="Filter worktrees…"
            value={subSearch}
            {...stylex.props(fieldStyles.bare, styles.filter)}
            onChange={(event) => setSubSearch(event.target.value)}
          />
          <div {...stylex.props(styles.body)}>
            {activeRepo.trees
              .filter(
                (tree) =>
                  treeChoice(tree).show && fuzzyMatches(subSearch, tree.label),
              )
              .map((tree) => treeRow(tree))}
          </div>
        </div>
      )}
    </>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(textStyles.eyebrow, menuStyles.label)}>
      {children}
    </div>
  );
}

function Empty() {
  return <div {...stylex.props(styles.empty)}>No matching filters</div>;
}

function PickerRow({
  label,
  checked,
  count,
  expanded,
  onClick,
  onHover,
  onLeave,
  onRight,
}: {
  label: string;
  checked: boolean | "mixed";
  count?: string;
  expanded?: boolean;
  onClick(): void;
  onHover?(row: HTMLButtonElement): void;
  onLeave?(): void;
  onRight?(row: HTMLButtonElement): void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-label={label}
      aria-checked={checked}
      data-picker-row
      aria-expanded={onRight ? expanded : undefined}
      {...stylex.props(
        filterRowMarker,
        focusStyles.ringInset,
        buttonStyles.reset,
        menuStyles.item,
        expanded && styles.expanded,
      )}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (
          onRight &&
          !(
            event.target instanceof Element &&
            event.target.closest("[data-picker-check]")
          )
        )
          onRight(event.currentTarget);
        else onClick();
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") onHover?.(event.currentTarget);
      }}
      onPointerLeave={onLeave}
      onKeyDown={(event) => {
        if ((event.key === "ArrowRight" || event.key === "Enter") && onRight) {
          event.preventDefault();
          onRight(event.currentTarget);
        } else if (event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <span
        data-picker-check
        aria-hidden="true"
        {...stylex.props(styles.checkHit)}
      >
        <CheckboxMark
          state={checked}
          xstyle={checked === false && styles.emptyCheck}
        />
      </span>
      <span {...stylex.props(styles.label)}>{label}</span>
      <span {...stylex.props(styles.faint, textStyles.count)}>{count}</span>
      {onRight && <span aria-hidden="true">›</span>}
    </button>
  );
}

const styles = stylex.create({
  popup: { width: "260px", gap: 0, positionAnchor: "--home-filter" },
  submenu: {
    width: "224px",
    gap: 0,
    positionAnchor: "--home-filter-row",
    top: "anchor(top)",
    left: "anchor(right)",
  },
  submenuStart: { left: "auto", right: "anchor(left)" },
  divider: {
    flexShrink: 0,
    height: "1px",
    marginBlock: space.s4,
    backgroundColor: tokens.rule,
  },
  filter: {
    flexShrink: 0,
    boxSizing: "border-box",
    width: "100%",
    height: "32px",
    padding: `0 ${space.s8}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
  },
  body: {
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    minHeight: 0,
    paddingBlock: space.s4,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  expanded: {
    anchorName: "--home-filter-row",
    backgroundColor: tokens.tray,
  },
  checkHit: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: "24px",
    height: "24px",
    margin: `-${space.s4}`,
  },
  emptyCheck: {
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", filterRowMarker)]: 1,
      [stylex.when.ancestor(":focus-visible", filterRowMarker)]: 1,
    },
  },
  label: { flex: 1, minWidth: 0, overflowWrap: "anywhere" },
  faint: { flexShrink: 0, color: tokens.inkFaint },
  footer: {
    display: "flex",
    flexShrink: 0,
    justifyContent: "space-between",
    gap: space.s8,
    padding: `${space.s8} ${space.s8} ${space.s4}`,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
    fontSize: fontSize.small,
  },
  hint: {
    padding: `${space.s4} ${space.s8}`,
    color: tokens.inkFaint,
    fontSize: fontSize.small,
  },
  empty: {
    padding: `${space.s12} ${space.s8}`,
    color: tokens.inkMuted,
    fontSize: fontSize.small,
  },
});
