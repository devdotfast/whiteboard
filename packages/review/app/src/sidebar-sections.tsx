import { BoardDisclosure } from "@canvas/ui/board-disclosure";
import { BoardIcon, PullRequestStateIcon } from "@canvas/ui/board-icons";
import { IconButton, buttonStyles } from "@canvas/ui/button";
import { CrumbSeparator } from "@canvas/ui/crumbs";
import { EmptyState } from "@canvas/ui/empty-state";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import { PlusIcon, SearchIcon, StackIcon } from "@canvas/ui/icons";
import { listRowStyles } from "@canvas/ui/list-row";
import { textStyles } from "@canvas/ui/text";
import { fieldStyles } from "@canvas/ui/text-field";
import { TooltipHostContext, useTooltip } from "@canvas/ui/tooltip";
import {
  type ReviewApiSummary,
  type ReviewSidebarSectionProps,
  boardIconKind,
  boardTitle,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AddChildWhiteboard } from "./add-child-whiteboard";
import { createCanvasQueryClient } from "./canvas-query";
import { ChangedBadge } from "./changed-badge";
import { CommitChanges, CommitPicker } from "./commit-picker";
import { countLabel } from "./format";
import { LensProgress, LensRows } from "./lens-list";
import { boardRowMarker } from "./markers.stylex";
import { type ReviewTocEntry, headingDepth } from "./review-document-headings";
import { worktreeLabel } from "./review-home-model";
import { fontSize, fontWeight, leading, radius, space } from "./scale.stylex";
import { ThreadsSectionBody } from "./sidebar-threads";
import { tokens } from "./tokens.stylex";
import {
  useExpandedParents,
  useWhiteboardExpansion,
} from "./whiteboard-expansion";
import {
  RECENT_SHOWN,
  type WhiteboardBranch,
  boardFamily,
  canAddChildWhiteboard,
  canExpandWhiteboard,
  cappedTree,
  recentTree,
  showsChanged,
  whiteboardTree,
} from "./whiteboard-tree";

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

/**
 * The project's whiteboards as a tree, capped until the reader
 * asks for the rest. A search lists every matching board flat.
 */
export function WhiteboardsList({
  project,
  current,
  query = "",
  onNewChild,
  onOpen,
}: {
  project: ProjectBoards | null;
  current: string;
  /** Text to find in titles; it searches every board, past the cap. */
  query?: string;
  onNewChild?(parentId: string): Promise<void>;
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
                onNewChild={onNewChild}
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
      {shown.map((branch) => (
        <BoardBranch
          key={branch.board.reviewId}
          branch={branch}
          onNewChild={onNewChild}
          current={current}
          expanded={expanded.has(branch.board.reviewId)}
          onToggle={() =>
            setExpanded(
              branch.board.reviewId,
              !expanded.has(branch.board.reviewId),
            )
          }
          onOpen={open}
        />
      ))}
      {showAll || hidden > 0 ? (
        <li>
          <button
            type="button"
            aria-expanded={showAll}
            data-show-more=""
            {...stylex.props(
              focusStyles.ringInset,
              buttonStyles.reset,
              listRowStyles.row,
              listRowStyles.wash,
              styles.treeRow,
              styles.more,
            )}
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
  recent = false,
  expanded,
  changed = Boolean(board.changed) && board.reviewId !== current,
  holdsCurrent = false,
  parentTitle,
  detail,
  onNewChild,
  onToggle,
  onOpen,
}: {
  board: ReviewApiSummary;
  current: string;
  nested?: boolean;
  recent?: boolean;
  /** A parent's state; undefined for a board without children. */
  expanded?: boolean;
  changed?: boolean;
  /** A collapsed parent whose child is open takes the open row's tint. */
  holdsCurrent?: boolean;
  /** In search results, a child's parent, named before it. */
  parentTitle?: string | false;
  detail?: string;
  onNewChild?(parentId: string): Promise<void>;
  onToggle?(): void;
  onOpen(reviewId: string, event: MouseEvent): void;
}): ReactElement {
  const [childError, setChildError] = useState("");
  const isCurrent = board.reviewId === current;

  const newChild =
    onNewChild && canAddChildWhiteboard(board) ? onNewChild : undefined;

  const tooltip = useTooltip(boardTitle(board.title), { detail });

  const [titleElement, setTitleElement] = useState<HTMLSpanElement | null>(
    null,
  );

  const [titleTruncated, setTitleTruncated] = useState(false);

  useLayoutEffect(() => {
    if (!titleElement) return;

    const measure = () =>
      setTitleTruncated(
        titleElement.scrollWidth > titleElement.clientWidth ||
          titleElement.scrollHeight > titleElement.clientHeight,
      );

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe(titleElement);

    return () => observer.disconnect();
  }, [titleElement, board.title]);

  return (
    <>
      <div
        {...stylex.props(
          boardRowMarker,
          listRowStyles.row,
          listRowStyles.wash,
          styles.treeRow,
          styles.boardRow,
          newChild && styles.rowWithAction,
          nested && styles.nestedRow,
          recent && styles.recentRow,
          (isCurrent || holdsCurrent) && listRowStyles.current,
        )}
      >
        <BoardDisclosure
          title={boardTitle(board.title)}
          expanded={expanded}
          onToggle={onToggle}
        />
        <button
          ref={titleTruncated ? tooltip : undefined}
          type="button"
          aria-current={isCurrent ? "page" : undefined}
          {...stylex.props(
            focusStyles.ringInset,
            buttonStyles.reset,
            styles.rowMain,
          )}
          onClick={(event) => onOpen(board.reviewId, event)}
        >
          <span {...stylex.props(styles.iconSlot)}>
            {board.children?.length ? (
              <StackIcon
                xstyle={[styles.stackIcon, isCurrent && styles.metaCurrent]}
              />
            ) : (
              <BoardIcon
                icon={boardIconKind(board.target)}
                current={isCurrent}
              />
            )}
            {changed ? <ChangedBadge /> : null}
          </span>
          <span
            {...stylex.props(styles.rowText, newChild && styles.textWithAction)}
          >
            {parentTitle ? (
              <span {...stylex.props(styles.path)}>
                <span
                  {...stylex.props(
                    textStyles.truncate,
                    styles.title,
                    styles.pathParent,
                    styles.faint,
                  )}
                >
                  {parentTitle}
                </span>
                <CrumbSeparator />
                <span
                  {...stylex.props(
                    textStyles.truncate,
                    styles.title,
                    styles.pathLeaf,
                    isCurrent && styles.titleCurrent,
                  )}
                  ref={setTitleElement}
                >
                  {boardTitle(board.title)}
                </span>
              </span>
            ) : (
              <span
                {...stylex.props(
                  textStyles.clamp2,
                  styles.title,
                  isCurrent && styles.titleCurrent,
                )}
                ref={setTitleElement}
              >
                {boardTitle(board.title)}
              </span>
            )}
          </span>
          {board.origin?.pullRequestNumber ? (
            <PullRequestStateIcon
              number={board.origin.pullRequestNumber}
              state={board.pullRequestState}
            />
          ) : null}
        </button>
        {newChild ? (
          <AddChildWhiteboard
            board={board}
            onCreate={newChild}
            onError={setChildError}
            xstyle={[
              styles.childAction,
              !!board.origin?.pullRequestNumber && styles.childActionWithPr,
            ]}
          />
        ) : null}
      </div>
      {childError ? (
        <p role="alert" {...stylex.props(textStyles.error, styles.rowError)}>
          {childError}
        </p>
      ) : null}
    </>
  );
}

/** The document's headings, as the Diff view's folded Contents lists them;
 * a click opens the document at one. */
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
  // Top-level sections are numbered; each deeper section is indented one
  // step under its parent.
  const depth = headingDepth;

  const sectionNumbers = new Map(
    entries
      .filter((entry) => depth(entry) === 1)
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
              focusStyles.ringInset,
              buttonStyles.reset,
              listRowStyles.row,
              listRowStyles.wash,
              styles.entry,
              depth(entry) > 1 && styles.nested,
              depth(entry) > 1 && styles.indent(depth(entry) - 2),
              entry.id === active && listRowStyles.current,
            )}
            onClick={() => onOpen(entry.id)}
          >
            {depth(entry) === 1 ? (
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
                textStyles.truncate,
                styles.title,
                styles.entryText,
                depth(entry) > 1 && styles.entryTextNested,
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
  const [queryClient] = useState(createCanvasQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipHostContext.Provider value={props.setupTooltip}>
        <SectionBody {...props} />
      </TooltipHostContext.Provider>
    </QueryClientProvider>
  );
}

function SectionBody(props: ReviewSidebarSectionProps): ReactElement | null {
  // A picked commit's own changes: its lines can't count as viewed against
  // the board's range, so there is nothing to show as remaining.
  const picked = props.commits?.list.find(
    ({ commit }) => commit === props.commits?.selected,
  );

  if (props.section === "remaining" && picked)
    return (
      <div {...stylex.props(styles.lenses, styles.remaining)}>
        <CommitChanges commit={picked} />
      </div>
    );

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

  if (props.section === "commitPicker")
    return props.commits ? (
      <CommitPicker
        commits={props.commits.list}
        selected={props.commits.selected}
        onPick={(commit) => props.onPickCommit?.(commit)}
      />
    ) : null;

  if (props.section === "recent")
    return (
      <RecentBoards
        boards={props.recent ?? props.project?.boards ?? []}
        current={props.reviewId}
        onNewChild={props.onNewChildWhiteboard}
        onOpen={(id, event) =>
          props.onOpenBoard(
            id,
            !(event.metaKey || event.ctrlKey || event.shiftKey),
          )
        }
      />
    );

  if (props.section === "family") return <FamilySectionBody {...props} />;

  return <WhiteboardsSectionBody {...props} />;
}

/**
 * The top of the Whiteboard tab: a search over every board in the
 * project, its matches listed under it. Desktop puts THIS BOARD (the open
 * board's family) next, then RECENT (the boards opened last); while a
 * search shows matches, THIS BOARD steps aside.
 */
function WhiteboardsSectionBody({
  project,
  reviewId,
  onNewChildWhiteboard,
  onOpenBoard,
}: ReviewSidebarSectionProps): ReactElement | null {
  const [query, setQuery] = useState("");

  return (
    <div data-searching={query.trim() ? "" : undefined}>
      <label
        {...stylex.props(fieldStyles.box, fieldStyles.shell, styles.search)}
      >
        <SearchIcon xstyle={styles.searchIcon} />
        <input
          type="search"
          value={query}
          placeholder="Find a whiteboard"
          aria-label="Find a whiteboard"
          {...stylex.props(fieldStyles.bare, styles.searchInput)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
        />
      </label>
      {query.trim() ? (
        <WhiteboardsList
          project={project ?? null}
          current={reviewId}
          query={query}
          onNewChild={onNewChildWhiteboard}
          onOpen={onOpenBoard}
        />
      ) : null}
    </div>
  );
}

/** THIS BOARD: the open board's family, and the "+" for a new whiteboard. */
function FamilySectionBody({
  project,
  reviewId,
  onOpenBoard,
  onNewWhiteboard,
  onNewChildWhiteboard,
  newWhiteboardShortcut,
}: ReviewSidebarSectionProps): ReactElement {
  const family = boardFamily(project?.boards ?? [], reviewId);

  const open = (id: string, event: MouseEvent) =>
    onOpenBoard(id, !(event.metaKey || event.ctrlKey || event.shiftKey));

  return (
    <>
      <GroupHeader
        title="This board"
        count={family ? familyCount(family, reviewId) : undefined}
      >
        {onNewWhiteboard ? (
          <NewWhiteboardButton
            shortcut={newWhiteboardShortcut}
            onClick={onNewWhiteboard}
          />
        ) : null}
      </GroupHeader>
      {family ? (
        <BoardFamily
          key={family.board.reviewId}
          family={family}
          projectId={project?.project?.id}
          onNewChild={onNewChildWhiteboard}
          current={reviewId}
          onOpen={open}
        />
      ) : null}
    </>
  );
}

/** "3 of 8" on a child; a parent counts its children. */
function familyCount(family: WhiteboardBranch, current: string) {
  const index = family.children.findIndex(
    (child) => child.reviewId === current,
  );

  if (index >= 0) return `${index + 1} of ${family.children.length}`;

  return family.children.length
    ? countLabel(family.children.length, "step")
    : undefined;
}

/** A group's title in the pane's header type, its count faint after it. */
function GroupHeader({
  title,
  count,
  children,
}: {
  title: string;
  count?: ReactNode;
  children?: ReactNode;
}): ReactElement {
  return (
    <div {...stylex.props(styles.groupHeader)}>
      <span {...stylex.props(textStyles.sectionTitle, styles.groupTitle)}>
        {title}
      </span>
      {count ? (
        <span
          {...stylex.props(
            textStyles.count,
            textStyles.truncate,
            styles.groupCount,
          )}
        >
          {count}
        </span>
      ) : null}
      {children ? (
        <span {...stylex.props(styles.groupAction)}>{children}</span>
      ) : null}
    </div>
  );
}

/** The "+" that starts a new whiteboard, as ⌘N does. */
function NewWhiteboardButton({
  shortcut,
  onClick,
}: {
  shortcut?: string;
  onClick(): void;
}): ReactElement {
  const tooltip = useTooltip("New whiteboard", {
    ...(shortcut && { detail: shortcut }),
  });

  return (
    <IconButton
      ref={tooltip}
      size="small"
      aria-label="New whiteboard"
      onClick={onClick}
    >
      <PlusIcon xstyle={iconStyles.inline} />
    </IconButton>
  );
}

/** The open board's parent, or the board itself at top level, with its
 * children in order. */
function BoardFamily({
  family,
  projectId,
  current,
  onNewChild,
  onOpen,
}: {
  family: WhiteboardBranch;
  projectId?: string;
  current: string;
  onNewChild?(parentId: string): Promise<void>;
  onOpen(reviewId: string, event: MouseEvent): void;
}): ReactElement {
  const { isExpanded, setExpanded } = useWhiteboardExpansion();
  const project = projectId ?? family.board.project?.id;

  const expanded = isExpanded(
    project,
    family.board.reviewId,
    family.children.length > 0,
  );

  useEffect(() => {
    if (current !== family.board.reviewId)
      setExpanded(project, family.board.reviewId, true);
  }, [current, project, family.board.reviewId, setExpanded]);

  return (
    <ul aria-label="This board" {...stylex.props(styles.list)}>
      <BoardBranch
        branch={family}
        onNewChild={onNewChild}
        current={current}
        expanded={expanded}
        onToggle={() => setExpanded(project, family.board.reviewId, !expanded)}
        onOpen={onOpen}
      />
    </ul>
  );
}

function BoardBranch({
  branch,
  current,
  expanded,
  recent,
  onNewChild,
  onToggle,
  onOpen,
}: {
  branch: WhiteboardBranch;
  current: string;
  expanded: boolean;
  recent?: boolean;
  onNewChild?(parentId: string): Promise<void>;
  onToggle(): void;
  onOpen(reviewId: string, event: MouseEvent): void;
}): ReactElement {
  const parent = branch.children.length > 0;

  return (
    <li>
      <BoardRow
        board={branch.board}
        onNewChild={onNewChild}
        current={current}
        recent={recent}
        detail={
          recent
            ? worktreeLabel(branch.board) || branch.board.project?.name
            : undefined
        }
        expanded={
          canExpandWhiteboard(branch, Boolean(onNewChild))
            ? expanded
            : undefined
        }
        changed={showsChanged(branch, current, !expanded)}
        holdsCurrent={
          !expanded &&
          branch.children.some((child) => child.reviewId === current)
        }
        onToggle={onToggle}
        onOpen={onOpen}
      />
      {parent && expanded ? (
        <FamilyChildren family={branch} current={current} onOpen={onOpen} />
      ) : !parent &&
        expanded &&
        onNewChild &&
        canAddChildWhiteboard(branch.board) ? (
        <EmptyState
          xstyle={styles.emptyChildren}
          message="No child whiteboards"
        />
      ) : null}
    </li>
  );
}

/**
 * A parent's children under its row, which stays put: past eight and a half
 * rows they scroll in a capped area, the half row showing there is more.
 * Soft fades mark the edges with more beyond them. The open board starts
 * centred, and again when another opens; the reader's scrolling is theirs.
 */
function FamilyChildren({
  family,
  current,
  onOpen,
}: {
  family: WhiteboardBranch;
  projectId?: string;
  current: string;
  onOpen(reviewId: string, event: MouseEvent): void;
}): ReactElement {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ above: false, below: false });

  const measure = useCallback(() => {
    const element = scroller.current;

    if (!element) return;
    const above = element.scrollTop > 0;

    const below =
      element.scrollTop + element.clientHeight < element.scrollHeight - 1;

    setMore((last) =>
      last.above === above && last.below === below ? last : { above, below },
    );
  }, []);

  // The open board this area was last centred on; it centres once per
  // board, as soon as it is laid out, and then leaves scrolling alone.
  const centred = useRef<string | null>(null);

  const centre = useCallback(() => {
    const element = scroller.current;
    const row = element?.querySelector<HTMLElement>("[aria-current]");

    if (!element || !row || !element.clientHeight) return;
    centred.current = current;
    element.scrollTop =
      row.offsetTop - (element.clientHeight - row.offsetHeight) / 2;
  }, [current]);

  useLayoutEffect(() => {
    centred.current = null;
    centre();
    measure();
  }, [current, family.board.reviewId, centre, measure]);

  useEffect(() => {
    const element = scroller.current;

    if (!element) return;

    const observer = new ResizeObserver(() => {
      // Mounted hidden, it centres when it first shows.
      if (centred.current !== current) centre();
      measure();
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [centre, current, measure]);

  return (
    <div {...stylex.props(styles.familyViewport)}>
      <div
        ref={scroller}
        data-family-scroller=""
        {...stylex.props(styles.familyScroller)}
        onScroll={measure}
      >
        <ul
          aria-label={`In ${boardTitle(family.board.title)}`}
          {...stylex.props(styles.children)}
        >
          {family.children.map((child) => (
            <li key={child.reviewId}>
              <BoardRow
                board={child}
                current={current}
                nested
                onOpen={onOpen}
              />
            </li>
          ))}
        </ul>
      </div>
      {more.above ? (
        <div data-fade="top" {...stylex.props(styles.fade, styles.fadeTop)} />
      ) : null}
      {more.below ? (
        <div
          data-fade="bottom"
          {...stylex.props(styles.fade, styles.fadeBottom)}
        />
      ) : null}
    </div>
  );
}

/** The boards opened last, five until the reader asks for the rest. */
function RecentBoards({
  boards,
  current,
  onNewChild,
  onOpen,
}: {
  boards: readonly ReviewApiSummary[];
  current: string;
  onNewChild?(parentId: string): Promise<void>;
  onOpen(reviewId: string, event: MouseEvent): void;
}): ReactElement | null {
  const [showAll, setShowAll] = useState(false);
  const { expanded, setExpanded } = useWhiteboardExpansion();
  const tree = recentTree(boards, current);

  if (!tree.length) return null;
  const hidden = tree.length - RECENT_SHOWN;

  return (
    <>
      <GroupHeader title="Recent" />
      <ul aria-label="Recent" {...stylex.props(styles.list)}>
        {(showAll ? tree : tree.slice(0, RECENT_SHOWN)).map((branch) => (
          <BoardBranch
            key={branch.board.reviewId}
            branch={branch}
            onNewChild={onNewChild}
            current={current}
            expanded={expanded(branch.board.project?.id).has(
              branch.board.reviewId,
            )}
            recent
            onToggle={() =>
              setExpanded(
                branch.board.project?.id,
                branch.board.reviewId,
                !expanded(branch.board.project?.id).has(branch.board.reviewId),
              )
            }
            onOpen={onOpen}
          />
        ))}
        {hidden > 0 ? (
          <li>
            <button
              type="button"
              aria-expanded={showAll}
              data-show-more=""
              {...stylex.props(
                buttonStyles.reset,
                listRowStyles.row,
                listRowStyles.wash,
                styles.treeRow,
                styles.more,
              )}
              onClick={() => setShowAll(!showAll)}
            >
              <span {...stylex.props(styles.moreTextFlat)}>
                {showAll ? "Show less" : `Show ${hidden} more`}
              </span>
            </button>
          </li>
        ) : null}
      </ul>
    </>
  );
}

/** A board row's height, which the family's cap counts in. */
const FAMILY_ROW = space.s28;

// A subsection's text lines up with its section's, past the number.
const NESTED_INSET = "30px";

const styles = stylex.create({
  lenses: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    paddingBottom: space.s6,
    color: tokens.ink,
    font: `${fontSize.body}/${leading.normal} ${tokens.chromeFont}`,
  },
  remaining: { paddingBottom: 0 },
  search: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    height: "28px",
    marginBlock: `${space.s4} ${space.s8}`,
    marginInline: space.s12,
    paddingInline: space.s10,
    borderRadius: radius.control,
    backgroundColor: tokens.surface,
  },
  searchIcon: { width: "13px", height: "13px", color: tokens.inkFaint },
  searchInput: {
    flex: 1,
    lineHeight: leading.px16,
    // Escape clears the search; the platform's clear button would add a
    // second, blue, control.
    "::-webkit-search-cancel-button": { display: "none" },
  },
  list: {
    display: "flex",
    flexDirection: "column",
    margin: 0,
    padding: `${space.s2} ${space.s8} ${space.s8}`,
    listStyle: "none",
  },
  // From the pane's edge: the chevron slot at 8px, a top-level icon at
  // 26px and its title at 46px; a child's icon at 42px and title at 62px.
  treeRow: { gap: 0, paddingInline: `0 ${space.s8}`, cursor: "default" },
  nestedRow: { paddingInline: `${space.s16} ${space.s8}` },
  boardRow: {
    height: "auto",
    minHeight: space.s28,
    paddingBlock: space.s4,
    fontSize: fontSize.ui,
  },
  recentRow: { minHeight: space.s40 },
  rowText: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    gap: space.s2,
  },
  textWithAction: { paddingInlineEnd: space.s20 },
  rowWithAction: { position: "relative" },
  childAction: { position: "absolute", insetInlineEnd: space.s8 },
  childActionWithPr: { insetInlineEnd: space.s28 },
  stackIcon: { width: space.s14, height: space.s14, color: tokens.inkMuted },
  rowMain: {
    display: "flex",
    flex: 1,
    alignItems: "center",
    gap: space.s6,
    marginLeft: space.s2,
    minWidth: 0,
    height: "100%",
    padding: 0,
    color: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  chevronSlot: {
    flexShrink: 0,
    display: "flex",
    width: "16px",
    height: "16px",
  },
  rowError: { margin: space.s8, fontSize: fontSize.small },
  emptyChildren: {
    margin: 0,
    padding: `${space.s4} ${space.s24}`,
    color: tokens.inkFaint,
    fontSize: fontSize.small,
  },
  path: {
    display: "flex",
    flex: "1 1 auto",
    alignItems: "center",
    gap: space.s4,
    minWidth: 0,
  },
  children: { margin: 0, padding: 0, listStyle: "none" },
  familyViewport: { position: "relative" },
  // Eight and a half rows; a thin scrollbar only while hovered.
  familyScroller: {
    position: "relative",
    maxHeight: `calc(8.5 * ${FAMILY_ROW})`,
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollbarWidth: "thin",
    scrollbarColor: {
      default: `${tokens.transparent} ${tokens.transparent}`,
      ":hover": `${tokens.ghost} ${tokens.transparent}`,
    },
  },
  fade: {
    position: "absolute",
    insetInline: 0,
    height: "28px",
    pointerEvents: "none",
  },
  fadeTop: {
    top: 0,
    backgroundImage: `linear-gradient(to bottom, ${tokens.tray}, ${tokens.transparent})`,
  },
  fadeBottom: {
    bottom: 0,
    backgroundImage: `linear-gradient(to top, ${tokens.tray}, ${tokens.transparent})`,
  },
  faint: { color: tokens.inkFaint },
  pathParent: { flex: "0 1 auto" },
  // The parent's title gives way first; the board's own keeps most of the row.
  pathLeaf: { flex: "0 0 auto", maxWidth: "80%" },
  moreIcon: { marginLeft: space.s2 },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: space.s8,
    height: "28px",
    marginTop: space.s6,
    paddingInline: `${space.s14} ${space.s12}`,
    color: tokens.inkMuted,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.small,
    lineHeight: leading.px14,
  },
  groupTitle: { whiteSpace: "nowrap" },
  // A count in Inter; a branch range in it is code.
  groupCount: { minWidth: 0, color: tokens.inkFaint },
  groupAction: { display: "flex", marginLeft: "auto" },
  moreText: { marginLeft: space.s6 },
  moreTextFlat: { marginLeft: space.s2 },
  entry: { height: "24px" },
  nested: { height: "24px", paddingLeft: NESTED_INSET },
  // Each level below a subsection indents one more step.
  indent: (steps: number) => ({
    paddingLeft: `calc(${NESTED_INSET} + ${16 * steps}px)`,
  }),
  more: { cursor: "pointer", color: tokens.inkFaint },
  entryNumber: {
    flexShrink: 0,
    width: "12px",
    color: tokens.inkFaint,
    fontVariantNumeric: "tabular-nums",
    fontSize: fontSize.small,
    lineHeight: leading.px14,
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
  title: { flex: "1 1 auto", minWidth: 0 },
  titleCurrent: { fontWeight: fontWeight.medium },
  metaCurrent: { color: tokens.accent },
});
