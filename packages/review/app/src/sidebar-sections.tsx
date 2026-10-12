import {
  type ReviewApiSummary,
  type ReviewSidebarSectionProps,
  boardIconKind,
  boardTitle,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

import { BoardIcon, PullRequestStateIcon } from "./board-icons";
import { ChangedBadge } from "./changed-badge";
import { reviewPreferenceKey } from "./host/review-client";
import { LensProgress, LensRows } from "./lens-list";
import type { ReviewTocEntry } from "./review-document-headings";
import { readReviewUiState, writeReviewUiState } from "./review-ui-state";
import { fontSize, fontWeight, radius } from "./scale.stylex";
import { ThreadsSectionBody } from "./sidebar-threads";
import { tokens } from "./tokens.stylex";
import { TooltipHostContext } from "./use-tooltip";
import { cappedTree, showsChanged, whiteboardTree } from "./whiteboard-tree";

export interface ProjectBoards {
  project: ReviewApiSummary["project"] | null;
  boards: ReviewApiSummary[];
}

/** Search results: every board, most recently updated first (a summary's
 * createdAt is its latest version's). */
function newestFirst(boards: readonly ReviewApiSummary[]) {
  return [...boards].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

const readExpanded = (key: string | undefined) =>
  new Set(key ? (readReviewUiState<string[]>("reader", key) ?? []) : []);

/** The parents the reader expanded in one project, remembered across
 * windows and relaunches. */
function useExpandedParents(
  projectId: string | undefined,
): [ReadonlySet<string>, (parentId: string, expanded: boolean) => void] {
  const key =
    projectId && reviewPreferenceKey("whiteboards-expanded", projectId);

  const [state, setState] = useState(() => ({ key, ids: readExpanded(key) }));
  const ids = state.key === key ? state.ids : readExpanded(key);

  const setExpanded = useCallback(
    (parentId: string, expanded: boolean) =>
      setState((previous) => {
        const base = previous.key === key ? previous.ids : readExpanded(key);

        if (base.has(parentId) === expanded) return { key, ids: base };
        const next = new Set(base);

        if (expanded) next.add(parentId);
        else next.delete(parentId);

        if (key) writeReviewUiState("reader", key, [...next]);

        return { key, ids: next };
      }),
    [key],
  );

  return [ids, setExpanded];
}

/**
 * The project's whiteboards as a tree, capped until the reader
 * asks for the rest. A search lists every matching board flat.
 */
export function WhiteboardsList({
  project,
  current,
  query = "",
  onOpen,
}: {
  project: ProjectBoards | null;
  current: string;
  /** Text to find in titles; it searches every board, past the cap. */
  query?: string;
  onOpen(reviewId: string, active: boolean): void;
}): ReactElement | null {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useExpandedParents(project?.project?.id);

  const parentOfCurrent = project?.boards.find(
    (board) => board.reviewId === current,
  )?.parentId;

  // Opening a board inside a parent expands it; collapsing it again holds.
  useEffect(() => {
    if (parentOfCurrent) setExpanded(parentOfCurrent, true);
  }, [current, parentOfCurrent, setExpanded]);

  if (!project?.project) return null;
  const needle = query.trim().toLowerCase();

  const open = (reviewId: string, event: MouseEvent) =>
    onOpen(reviewId, !(event.metaKey || event.ctrlKey || event.shiftKey));

  if (needle) {
    const titles = new Map(
      project.boards.map((board) => [board.reviewId, boardTitle(board.title)]),
    );

    return (
      <ul aria-label="Whiteboards" {...stylex.props(styles.list)}>
        {newestFirst(project.boards)
          .filter((board) =>
            boardTitle(board.title).toLowerCase().includes(needle),
          )
          .map((board) => (
            <li key={board.reviewId}>
              <BoardRow
                board={board}
                current={current}
                parentTitle={board.parentId && titles.get(board.parentId)}
                onOpen={open}
              />
            </li>
          ))}
      </ul>
    );
  }

  const tree = whiteboardTree(project.boards);
  const shown = showAll ? tree : cappedTree(tree, current);
  const hidden = tree.length - shown.length;

  return (
    <ul aria-label="Whiteboards" {...stylex.props(styles.list)}>
      {shown.map((branch) => {
        const parent = branch.children.length > 0;
        const isExpanded = parent && expanded.has(branch.board.reviewId);

        return (
          <li key={branch.board.reviewId}>
            <BoardRow
              board={branch.board}
              current={current}
              expanded={parent ? isExpanded : undefined}
              changed={showsChanged(branch, current, !isExpanded)}
              holdsCurrent={
                !isExpanded &&
                branch.children.some((child) => child.reviewId === current)
              }
              onToggle={() => setExpanded(branch.board.reviewId, !isExpanded)}
              onOpen={open}
            />
            {isExpanded ? (
              <ul
                aria-label={`In ${boardTitle(branch.board.title)}`}
                {...stylex.props(styles.children)}
              >
                {branch.children.map((child) => (
                  <li key={child.reviewId}>
                    <BoardRow
                      board={child}
                      current={current}
                      nested
                      onOpen={open}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
      {showAll || hidden > 0 ? (
        <li>
          <button
            type="button"
            aria-expanded={showAll}
            data-show-more=""
            {...stylex.props(styles.row, styles.treeRow, styles.more)}
            onClick={() => setShowAll(!showAll)}
          >
            <span {...stylex.props(styles.chevronSlot)} />
            <span {...stylex.props(styles.iconSlot, styles.moreIcon)} />
            <span {...stylex.props(styles.moreText)}>
              {showAll ? "Show less" : `Show ${hidden} more`}
            </span>
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function BoardRow({
  board,
  current,
  nested = false,
  expanded,
  changed = Boolean(board.changed) && board.reviewId !== current,
  holdsCurrent = false,
  parentTitle,
  onToggle,
  onOpen,
}: {
  board: ReviewApiSummary;
  current: string;
  nested?: boolean;
  /** A parent's state; undefined for a board without children. */
  expanded?: boolean;
  changed?: boolean;
  /** A collapsed parent whose child is open takes the open row's tint. */
  holdsCurrent?: boolean;
  /** In search results, a child's parent, named before it. */
  parentTitle?: string | false;
  onToggle?(): void;
  onOpen(reviewId: string, event: MouseEvent): void;
}): ReactElement {
  const isCurrent = board.reviewId === current;

  return (
    <div
      {...stylex.props(
        styles.row,
        styles.treeRow,
        nested && styles.nestedRow,
        (isCurrent || holdsCurrent) && styles.rowCurrent,
      )}
    >
      {expanded === undefined ? (
        <span {...stylex.props(styles.chevronSlot)} />
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${boardTitle(board.title)}`}
          {...stylex.props(styles.chevronSlot, styles.chevron)}
          onClick={onToggle}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d={
                expanded
                  ? "M4.5 6.25 8 10l3.5-3.75"
                  : "M6.25 4.5 10 8l-3.75 3.5"
              }
            />
          </svg>
        </button>
      )}
      <button
        type="button"
        aria-current={isCurrent ? "page" : undefined}
        {...stylex.props(styles.rowMain)}
        onClick={(event) => onOpen(board.reviewId, event)}
      >
        <span {...stylex.props(styles.iconSlot)}>
          <BoardIcon icon={boardIconKind(board.target)} current={isCurrent} />
          {changed ? <ChangedBadge onIcon /> : null}
        </span>
        {parentTitle ? (
          <span {...stylex.props(styles.path)}>
            <span
              {...stylex.props(styles.title, styles.pathParent, styles.faint)}
            >
              {parentTitle}
            </span>
            <span {...stylex.props(styles.separator)}>›</span>
            <span
              {...stylex.props(
                styles.title,
                styles.pathLeaf,
                isCurrent && styles.titleCurrent,
              )}
            >
              {boardTitle(board.title)}
            </span>
          </span>
        ) : (
          <span
            {...stylex.props(styles.title, isCurrent && styles.titleCurrent)}
          >
            {boardTitle(board.title)}
          </span>
        )}
        <span {...stylex.props(styles.meta, isCurrent && styles.metaCurrent)}>
          {board.origin?.pullRequestNumber ? (
            <PullRequestStateIcon
              number={board.origin.pullRequestNumber}
              state={board.pullRequestState}
            />
          ) : null}
        </span>
      </button>
    </div>
  );
}

/** The document's headings; a click scrolls the canvas to one. */
export function ContentsList({
  entries,
  active,
  onOpen,
}: {
  entries: readonly ReviewTocEntry[];
  /** The heading in view, tinted. */
  active?: string;
  onOpen(headingId: string): void;
}): ReactElement {
  // Sections are numbered; their subsections are indented under them.
  const sectionNumbers = new Map(
    entries
      .filter((entry) => entry.level === "h2")
      .map((entry, index) => [entry.id, index + 1]),
  );

  return (
    <ul aria-label="Contents" {...stylex.props(styles.list)}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            aria-current={entry.id === active ? "location" : undefined}
            {...stylex.props(
              styles.row,
              styles.entry,
              entry.level === "h3" && styles.nested,
              entry.id === active && styles.rowCurrent,
            )}
            onClick={() => onOpen(entry.id)}
          >
            {entry.level === "h2" ? (
              <span
                {...stylex.props(
                  styles.entryNumber,
                  entry.id === active && styles.metaCurrent,
                )}
              >
                {sectionNumbers.get(entry.id)}
              </span>
            ) : null}
            <span
              {...stylex.props(
                styles.title,
                styles.entryText,
                entry.level === "h3" && styles.entryTextNested,
                entry.id === active && styles.entryTextCurrent,
              )}
            >
              {entry.text}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One section of Desktop's sidebar, as its part mounts it, with the
 * workbench's tooltips. */
export function ReviewSidebarSection(
  props: ReviewSidebarSectionProps,
): ReactElement {
  return (
    <TooltipHostContext.Provider value={props.setupTooltip}>
      <SectionBody {...props} />
    </TooltipHostContext.Provider>
  );
}

function SectionBody(props: ReviewSidebarSectionProps): ReactElement | null {
  if (props.section === "remaining")
    return props.lenses ? (
      <div {...stylex.props(styles.lenses, styles.remaining)}>
        <LensProgress lenses={props.lenses} inset />
      </div>
    ) : null;

  if (props.section === "lenses")
    return props.lenses ? (
      <div {...stylex.props(styles.lenses)}>
        <LensRows
          inset
          lenses={props.lenses}
          onSelect={(lensId) => props.onSelectLens?.(lensId)}
          onMark={(lensId) => props.onMarkLens?.(lensId)}
        />
      </div>
    ) : null;

  if (props.section === "threads") return <ThreadsSectionBody {...props} />;

  if (props.section === "contents")
    return (
      <ContentsList
        entries={props.contents}
        active={props.activeHeading}
        onOpen={props.onOpenHeading}
      />
    );

  return <WhiteboardsSectionBody {...props} />;
}

function WhiteboardsSectionBody({
  project,
  reviewId,
  onOpenBoard,
}: ReviewSidebarSectionProps): ReactElement | null {
  const [query, setQuery] = useState("");

  return (
    <>
      <label {...stylex.props(styles.search)}>
        <svg
          width="13"
          height="13"
          viewBox="0 0 14 14"
          aria-hidden="true"
          {...stylex.props(styles.searchIcon)}
        >
          <circle cx="6" cy="6" r="3.75" />
          <path d="M8.75 8.75 L11.5 11.5" />
        </svg>
        <input
          type="search"
          value={query}
          placeholder="Find a whiteboard"
          aria-label="Find a whiteboard"
          {...stylex.props(styles.searchInput)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
        />
      </label>
      <WhiteboardsList
        project={project ?? null}
        current={reviewId}
        query={query}
        onOpen={onOpenBoard}
      />
    </>
  );
}

const styles = stylex.create({
  lenses: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    paddingBottom: "6px",
    color: tokens.ink,
    font: `${fontSize.body}/1.5 ${tokens.chromeFont}`,
  },
  remaining: { paddingBottom: 0 },
  search: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    height: "28px",
    marginBlock: "4px 8px",
    marginInline: "12px",
    paddingInline: "10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.control,
    backgroundColor: tokens.surface,
  },
  searchIcon: {
    flexShrink: 0,
    fill: "none",
    stroke: tokens.inkFaint,
    strokeWidth: 1.2,
    strokeLinecap: "round",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
    "::placeholder": { color: tokens.inkFaint },
    // Escape clears the search; the platform's clear button would add a
    // second, blue, control.
    "::-webkit-search-cancel-button": { display: "none" },
  },
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: "2px 8px 8px",
    listStyle: "none",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    height: "24px",
    paddingBlock: 0,
    paddingInline: "8px",
    borderWidth: 0,
    borderRadius: radius.small,
    backgroundColor: { default: "transparent", ":hover": tokens.markerTint },
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
    textAlign: "left",
    cursor: "pointer",
  },
  rowCurrent: { backgroundColor: tokens.markerTint },
  // From the pane's edge: the chevron slot at 8px, a top-level icon at
  // 26px and its title at 46px; a child's icon at 42px and title at 62px.
  treeRow: { gap: 0, paddingInline: "0 8px", cursor: "default" },
  nestedRow: { paddingInline: "16px 8px" },
  rowMain: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    gap: "6px",
    marginLeft: "2px",
    minWidth: 0,
    height: "100%",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  chevronSlot: {
    flexShrink: 0,
    display: "flex",
    width: "16px",
    height: "16px",
  },
  chevron: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    fill: "none",
    stroke: tokens.inkFaint,
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    cursor: "pointer",
  },
  path: {
    display: "flex",
    flex: "1 1 auto",
    alignItems: "center",
    gap: "5px",
    minWidth: 0,
  },
  children: { margin: 0, padding: 0, listStyle: "none" },
  faint: { color: tokens.inkFaint },
  pathParent: { flex: "0 1 auto" },
  separator: { flexShrink: 0, color: tokens.inkFaint },
  // The parent's title gives way first; the board's own keeps most of the row.
  pathLeaf: { flex: "0 0 auto", maxWidth: "80%" },
  moreIcon: { marginLeft: "2px" },
  moreText: { marginLeft: "6px" },
  entry: { height: "24px" },
  // A subsection's text lines up with its section's, past the number.
  nested: { height: "24px", paddingLeft: "30px" },
  more: {
    height: "24px",
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.markerTint },
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
  },
  entryNumber: {
    flexShrink: 0,
    width: "12px",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
    lineHeight: "14px",
  },
  entryText: { color: tokens.ink },
  entryTextNested: { color: tokens.inkMuted },
  entryTextCurrent: { color: tokens.ink, fontWeight: fontWeight.medium },
  iconSlot: {
    position: "relative",
    flexShrink: 0,
    display: "inline-flex",
    width: "14px",
    height: "14px",
  },
  title: {
    flex: "1 1 auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  titleCurrent: { fontWeight: fontWeight.medium },
  meta: {
    display: "flex",
    justifyContent: "flex-end",
    flexShrink: 0,
    width: "34px",
    textAlign: "right",
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    lineHeight: "14px",
  },
  metaCurrent: { color: tokens.accent },
});
