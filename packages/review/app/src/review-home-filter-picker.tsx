import type { ReviewApiSummary } from "@dev.fast/review-protocol";
import { fuzzyMatches } from "@review/fuzzy-match";
import * as stylex from "@stylexjs/stylex";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { filterRowMarker } from "./markers.stylex";
import { MenuSurface } from "./menu-surface";
import {
  type HomeFilters,
  type HomeRepository,
  homeRepositories,
  matchesHomeFilters,
  toggleHomeRepository,
  toggleHomeWorktree,
} from "./review-home-model";
import { styles as home } from "./review-home-styles";
import { fontSize, layer, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { Shortcut } from "./ui/kbd";

export type HomeFilterSection =
  | "all"
  | "repositories"
  | "worktrees"
  | "branches"
  | "unread";

type Tree = { key: string; label: string };

type Repository = HomeRepository;

type Choice = { checked: boolean | "mixed"; count?: string; show: boolean };

export function HomeFilterPicker({
  anchor,
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
  anchor: HTMLButtonElement;
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
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusSubmenu = useRef(false);
  const [search, setSearch] = useState("");
  const [subSearch, setSubSearch] = useState("");
  const [repository, setRepository] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, height: 420 });

  const [subPosition, setSubPosition] = useState({
    left: 0,
    top: 0,
    height: 320,
  });

  const scoped = section !== "all";

  const facetName =
    section === "repositories"
      ? "Repo"
      : section === "branches"
        ? "Branch"
        : section === "worktrees"
          ? "Worktree"
          : "Show";

  const menuWidth = scoped ? 250 : 260;

  const repositories = useMemo(() => homeRepositories(reviews), [reviews]);

  const activeRepo = repositories.find((repo) => repo.key === repository);

  const total = (next: HomeFilters) =>
    reviews.filter((review) => matchesHomeFilters(review, next, query)).length;

  function treeChoice(tree: Tree): Choice {
    const repo = repositories.find((repo) =>
      repo.trees.some((value) => value.key === tree.key),
    );

    const checked =
      filters.worktrees.includes(tree.key) ||
      Boolean(repo && filters.repositories.includes(repo.key));

    const ownCount = total({
      ...filters,
      repositories: [],
      worktrees: [tree.key],
    });

    const nextCount = total({
      ...filters,
      worktrees: [...filters.worktrees, tree.key],
    });

    const sibling =
      filters.worktrees.length > 0 || filters.repositories.length > 0;

    const added = nextCount - count;

    return {
      checked,
      count:
        !checked && sibling
          ? `+${added}`
          : String(checked ? ownCount : nextCount),
      show: checked || (ownCount > 0 && (!sibling || added > 0)),
    };
  }

  function repoChoice(repo: Repository): Choice {
    const checked =
      Boolean(repo.key) && filters.repositories.includes(repo.key);

    const partial = repo.trees.some((tree) =>
      filters.worktrees.includes(tree.key),
    );

    const next = repo.key
      ? { ...filters, repositories: [...filters.repositories, repo.key] }
      : {
          ...filters,
          worktrees: [
            ...new Set([
              ...filters.worktrees,
              ...repo.trees.map((tree) => tree.key),
            ]),
          ],
        };

    const ownCount = total({
      ...filters,
      repositories: repo.key ? [repo.key] : [],
      worktrees: repo.key ? [] : repo.trees.map((tree) => tree.key),
    });

    const nextCount = total(next);

    const sibling =
      filters.repositories.length > 0 || filters.worktrees.length > 0;

    const added = nextCount - count;

    return {
      checked: checked ? true : partial ? "mixed" : false,
      count:
        !checked && sibling
          ? `+${added}`
          : String(checked ? ownCount : nextCount),
      show: checked || partial || (ownCount > 0 && (!sibling || added > 0)),
    };
  }

  const cancelPending = () => {
    clearTimeout(pending.current);
    pending.current = undefined;
  };

  function openSubmenu(
    repo: Repository,
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

  function hoverRepository(repo: Repository, row: HTMLButtonElement) {
    cancelPending();

    if (repository === repo.key) return;
    // Resting for 100ms switches rows. Continuous diagonal motion toward the
    // overlapping submenu keeps resetting this intent timer instead of switching.
    pending.current = setTimeout(() => openSubmenu(repo, row, false), 100);
  }

  function canvasBounds() {
    // The desktop canvas uses layout containment, so it is the containing
    // block for fixed menus even when it starts below the workbench tabs.
    return (
      anchor?.closest(".review-canvas-root")?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        height: window.innerHeight,
      }
    );
  }

  useLayoutEffect(() => {
    const rect = anchor?.getBoundingClientRect();

    if (!rect) return;
    const bounds = canvasBounds();
    const height = Math.min(420, bounds.height - 24);

    const visibleHeight =
      scoped && main.current
        ? Math.min(height, main.current.scrollHeight + 2)
        : height;

    const top =
      rect.bottom + 6 + visibleHeight <= bounds.bottom
        ? rect.bottom + 6
        : Math.max(bounds.top + 12, bounds.bottom - visibleHeight - 12);

    setPosition({
      left:
        Math.max(
          bounds.left + 12,
          Math.min(
            alignment === "end" ? rect.right - menuWidth : rect.left,
            bounds.right - menuWidth - 12,
          ),
        ) - bounds.left,
      top: top - bounds.top,
      height: Math.min(height, bounds.bottom - top - 12),
    });
  }, [anchor, alignment, filters, count, menuWidth, scoped, search]);
  useLayoutEffect(() => {
    mainInput.current?.focus();
  }, [anchor]);
  useLayoutEffect(() => {
    if (
      repository === null ||
      !main.current ||
      !parentRow.current ||
      !sub.current
    )
      return;
    const parent = main.current.getBoundingClientRect();
    const row = parentRow.current.getBoundingClientRect();
    const width = sub.current.getBoundingClientRect().width;
    const bounds = canvasBounds();

    const roomLeft = parent.left - width + 4 >= bounds.left + 12;
    const roomRight = parent.right - 4 + width <= bounds.right - 12;

    const left =
      (alignment === "end" && roomLeft) || !roomRight
        ? Math.max(bounds.left + 12, parent.left - width + 4)
        : parent.right - 4;

    // Border + padding + filter header put the first option 39px below the top.
    // Measure relative to the menu so its entrance transform cannot shift the
    // submenu's final anchor when it is opened during the animation.
    const rowTop = bounds.top + position.top + row.top - parent.top;

    const top = Math.max(
      bounds.top + 12,
      Math.min(rowTop - 39, bounds.bottom - 100),
    );

    setSubPosition({
      left: left - bounds.left,
      top: top - bounds.top,
      height: Math.min(320, bounds.bottom - top - 12),
    });
  }, [repository, position, filters, count, search, alignment]);
  useLayoutEffect(() => {
    // Hover opens the submenu without moving the caret out of the parent.
    // Keyboard navigation and opening a Worktree chip explicitly enter it.
    if (repository !== null && focusSubmenu.current)
      subInput.current?.focus({ preventScroll: true });
    focusSubmenu.current = false;
  }, [repository]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !main.current?.contains(event.target) &&
        !sub.current?.contains(event.target) &&
        !anchor?.contains(event.target) &&
        !(
          event.target instanceof Element &&
          event.target.closest('[aria-label="Active filters"]')
        )
      )
        onClose();
    };

    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelPending();

        if (repository !== null) {
          setRepository(null);
          mainInput.current?.focus();
        } else onClose();
      } else if (
        event.key === "ArrowLeft" &&
        repository !== null &&
        event.target instanceof Node &&
        sub.current?.contains(event.target)
      ) {
        event.preventDefault();
        setRepository(null);
        parentRow.current?.focus();
      }
    };

    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", keydown, true);

    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", keydown, true);
      cancelPending();
    };
  }, [repository, onClose, anchor]);

  function navigate(
    event: React.KeyboardEvent<HTMLDivElement>,
    root: HTMLDivElement | null,
  ) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();

    const rows = [
      ...(root?.querySelectorAll<HTMLButtonElement>("[data-picker-row]") ?? []),
    ];

    const index = rows.findIndex((row) => row === document.activeElement);
    rows[
      (index + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length
    ]?.focus();
  }

  function focusPointerMenu(
    event: React.PointerEvent,
    input: HTMLInputElement | null,
  ) {
    if (
      event.pointerType === "mouse" &&
      input &&
      document.activeElement !== input
    )
      input.focus({ preventScroll: true });
  }

  const shows = ([["unread", "Unread only"]] as const).flatMap(
    ([key, label]) => {
      const n = total({ ...filters, [key]: true });

      return fuzzyMatches(search, label) && (filters[key] || n > 0)
        ? [{ key, label, n }]
        : [];
    },
  );

  const repoRows = repositories.filter(
    (repo) => repoChoice(repo).show && fuzzyMatches(search, repo.label),
  );

  const treeRows = search
    ? repositories.flatMap((repo) =>
        repo.trees
          .filter(
            (tree) => treeChoice(tree).show && fuzzyMatches(search, tree.label),
          )
          .map((tree) => ({ repo, tree })),
      )
    : [];

  const renderTree = (tree: Tree) => (
    <PickerRow
      key={tree.key}
      label={tree.label}
      {...treeChoice(tree)}
      onClick={() =>
        onChange((current) =>
          toggleHomeWorktree(current, tree.key, repositories),
        )
      }
    />
  );

  const renderRepo = (repo: Repository) => {
    const nested = repo.trees.length > 1;

    return (
      <PickerRow
        key={repo.key}
        label={repo.label}
        {...repoChoice(repo)}
        repository={repo.key}
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

  const renderShow = ({ key, label, n }: (typeof shows)[number]) => (
    <PickerRow
      key={key}
      label={label}
      checked={filters[key]}
      count={String(n)}
      onClick={() =>
        onChange((current) => ({
          ...current,
          [key]: !current[key],
        }))
      }
    />
  );

  const branchRows = [
    ...new Set(
      reviews
        .map((review) => review.origin?.branch)
        .filter((branch): branch is string => Boolean(branch)),
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .filter((branch) => fuzzyMatches(search, branch))
    .map((branch) => {
      const checked = filters.branches.includes(branch);
      const n = total({ ...filters, branches: [branch] });

      return { key: branch, checked, n };
    })
    .filter((row) => row.checked || row.n > 0);

  const facetRows =
    section === "branches"
      ? branchRows.map(({ key, checked, n }) => ({
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
        }))
      : section === "worktrees"
        ? repositories
            .flatMap((repo) => repo.trees)
            .sort((a, b) => a.label.localeCompare(b.label))
            .filter(
              (tree) =>
                treeChoice(tree).show && fuzzyMatches(search, tree.label),
            )
            .map((tree) => ({
              key: tree.key,
              checked: treeChoice(tree).checked,
              node: renderTree(tree),
            }))
        : section === "repositories"
          ? repoRows.map((repo) => ({
              key: repo.key,
              checked: repoChoice(repo).checked,
              node: renderRepo(repo),
            }))
          : shows.map((show) => ({
              key: show.key,
              checked: filters[show.key],
              node: renderShow(show),
            }));

  const selectedOrder =
    section === "branches"
      ? filters.branches
      : section === "worktrees"
        ? filters.worktrees
        : filters.repositories;

  const selectedRows = facetRows
    .filter((row) => row.checked !== false)
    .sort(
      (a, b) => selectedOrder.indexOf(a.key) - selectedOrder.indexOf(b.key),
    );

  const remainingRows = facetRows.filter((row) => row.checked === false);

  return (
    <>
      <MenuSurface
        ref={main}
        role="dialog"
        aria-label={scoped ? `${facetName} filters` : "Add filters"}
        tabIndex={-1}
        data-home-picker
        xstyle={[
          styles.popup,
          scoped && styles.facetPopup,
          styles.position(position.left, position.top, position.height),
        ]}
        onPointerEnter={(event) => focusPointerMenu(event, mainInput.current)}
        onPointerMove={(event) => focusPointerMenu(event, mainInput.current)}
        onKeyDown={(event) => navigate(event, main.current)}
      >
        <input
          ref={mainInput}
          aria-label={scoped ? facetName : "Filter options"}
          placeholder={scoped ? facetName : "Filter…"}
          value={search}
          {...stylex.props(styles.filter)}
          onChange={(event) => {
            setSearch(event.target.value);
            setRepository(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !scoped && search.trim())
              onSearch(search.trim());
          }}
        />
        <div
          {...stylex.props(styles.body)}
          onScroll={() => {
            cancelPending();
            setRepository(null);
          }}
        >
          {scoped ? (
            <>
              {selectedRows.map((row) => (
                <Fragment key={row.key}>{row.node}</Fragment>
              ))}
              {selectedRows.length > 0 && remainingRows.length > 0 && (
                <div role="separator" {...stylex.props(styles.divider)} />
              )}
              {remainingRows.map((row) => (
                <Fragment key={row.key}>{row.node}</Fragment>
              ))}
              {facetRows.length === 0 && (
                <div {...stylex.props(styles.empty)}>No matching filters</div>
              )}
            </>
          ) : (
            <>
              <div {...stylex.props(styles.hint)}>
                <Shortcut>enter</Shortcut> to keyword filter
              </div>
              {shows.length > 0 && (
                <section aria-label="Show filters">
                  <div {...stylex.props(styles.section)}>Show</div>
                  {shows.map(renderShow)}
                </section>
              )}
              {(repoRows.length > 0 || treeRows.length > 0) && (
                <section
                  aria-label="Repository filters"
                  data-picker-section="repositories"
                >
                  <div {...stylex.props(styles.section)}>Repository</div>
                  {repoRows.map(renderRepo)}
                  {treeRows.map(({ repo, tree }) => (
                    <PickerRow
                      key={tree.key}
                      label={`${repo.label} › ${tree.label}`}
                      {...treeChoice(tree)}
                      onClick={() =>
                        onChange((current) =>
                          toggleHomeWorktree(current, tree.key, repositories),
                        )
                      }
                    />
                  ))}
                </section>
              )}
              {!shows.length && !repoRows.length && !treeRows.length && (
                <div {...stylex.props(styles.empty)}>No matching filters</div>
              )}
            </>
          )}
        </div>
        <div {...stylex.props(styles.footer)}>
          <span>
            Showing {count} {count === 1 ? "board" : "boards"}
          </span>
          <span {...stylex.props(styles.muted)}>
            <Shortcut>esc</Shortcut> done
          </span>
        </div>
      </MenuSurface>
      {activeRepo && (
        <MenuSurface
          ref={sub}
          role="dialog"
          aria-label={`${activeRepo.label} worktrees`}
          tabIndex={-1}
          data-home-submenu
          xstyle={[
            styles.popup,
            styles.submenu,
            styles.position(
              subPosition.left,
              subPosition.top,
              subPosition.height,
            ),
          ]}
          onPointerEnter={(event) => {
            cancelPending();
            focusPointerMenu(event, subInput.current);
          }}
          onPointerMove={(event) => {
            cancelPending();
            focusPointerMenu(event, subInput.current);
          }}
          onKeyDown={(event) => navigate(event, sub.current)}
        >
          <input
            ref={subInput}
            aria-label="Filter worktrees"
            placeholder="Filter worktrees…"
            value={subSearch}
            {...stylex.props(styles.filter)}
            onChange={(event) => setSubSearch(event.target.value)}
          />
          <div {...stylex.props(styles.body)}>
            {activeRepo.trees
              .filter(
                (tree) =>
                  treeChoice(tree).show && fuzzyMatches(subSearch, tree.label),
              )
              .map((tree) => (
                <PickerRow
                  key={tree.key}
                  label={tree.label}
                  {...treeChoice(tree)}
                  onClick={() =>
                    onChange((current) =>
                      toggleHomeWorktree(current, tree.key, repositories),
                    )
                  }
                />
              ))}
          </div>
        </MenuSurface>
      )}
    </>
  );
}

function PickerRow({
  label,
  checked,
  count,
  repository,
  expanded,
  onClick,
  onHover,
  onLeave,
  onRight,
}: {
  label: string;
  checked: boolean | "mixed";
  count?: string;
  repository?: string;
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
      data-repository={repository}
      aria-expanded={onRight ? expanded : undefined}
      {...stylex.props(
        filterRowMarker,
        styles.row,
        expanded && styles.activeRow,
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
        <span
          {...stylex.props(
            home.checkboxBox,
            checked === false && styles.emptyCheck,
            checked !== false && home.checkboxChecked,
          )}
        >
          {checked !== false && (
            <svg viewBox="0 0 10 10" {...stylex.props(home.checkGlyph)}>
              <path
                d={checked === "mixed" ? "M2 5 H8" : "M2 5.2 4.2 7.4 8 3.2"}
              />
            </svg>
          )}
        </span>
      </span>
      <span {...stylex.props(styles.label)}>{label}</span>
      <span {...stylex.props(styles.count)}>{count}</span>
      {onRight && <span aria-hidden="true">›</span>}
    </button>
  );
}

const styles = stylex.create({
  popup: {
    position: "fixed",
    width: "260px",
  },
  position: (left: number, top: number, maxHeight: number) => ({
    left,
    top,
    maxHeight,
  }),
  facetPopup: { width: "250px" },
  divider: {
    height: "1px",
    marginBlock: "4px",
    flexShrink: 0,
    backgroundColor: tokens.rule,
  },
  submenu: { zIndex: layer.submenu, width: "224px" },
  filter: {
    height: "32px",
    minHeight: "32px",
    flexShrink: 0,
    width: "100%",
    boxSizing: "border-box",
    borderWidth: 0,
    borderBottomWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    outlineStyle: "none",
    backgroundColor: "transparent",
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    padding: "0 8px",
    marginBottom: "0px",
  },
  body: { overflowY: "auto", minHeight: 0, overscrollBehavior: "contain" },
  section: {
    padding: "10px 8px 4px",
    color: tokens.inkFaint,
    fontSize: fontSize.small,
    lineHeight: "14px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    minHeight: "28px",
    padding: "5px 8px",
    boxSizing: "border-box",
    borderWidth: 0,
    borderRadius: radius.control,
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.homeHover,
      ":focus-visible": tokens.homeHover,
    },
    outlineStyle: "none",
    color: tokens.ink,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.body,
    lineHeight: "18px",
    textAlign: "left",
    cursor: "pointer",
  },
  checkHit: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    flexShrink: 0,
    margin: "-3px -5px",
  },
  emptyCheck: {
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", filterRowMarker)]: 1,
      [stylex.when.ancestor(":focus-visible", filterRowMarker)]: 1,
    },
  },
  activeRow: { backgroundColor: tokens.homeHover },
  label: { flex: 1, minWidth: 0, overflowWrap: "anywhere" },
  count: { flexShrink: 0, color: tokens.inkFaint, fontSize: fontSize.small },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    padding: "10px 8px 4px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
    fontSize: fontSize.small,
    lineHeight: "14px",
    flexShrink: 0,
  },
  muted: { color: tokens.inkFaint },
  hint: {
    padding: "5px 8px",
    fontSize: fontSize.small,
    color: tokens.inkFaint,
  },
  empty: {
    padding: "12px 8px",
    fontSize: fontSize.body,
    color: tokens.inkMuted,
  },
});
