import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { textStyles } from "@canvas/ui/text";
import type {
  ReviewCommitScope,
  ReviewDiffLens,
  ReviewDiffProgress,
  ReviewDiffViewHandle,
  ReviewSidebarLenses,
} from "@dev.fast/review-protocol";
import {
  type Lens,
  UNCATEGORIZED_LENS_ID,
} from "@review/review-api/diff-lenses";
import {
  type CoverageProgress,
  coverageProgress,
  coverageSources,
} from "@review/viewed-coverage";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { AskCodePins } from "./ask-code-pins";
import { AuthoringActivityContext } from "./authoring-activity-context";
import { scopeLive } from "./authoring-cursor";
import { Courier, LensCursorContext, lensRowElement } from "./courier";
import { DiffSidebarFolds } from "./diff-sidebar-folds";
import { type MotionPhase, withErasedBlocks } from "./draw-queue";
import { useMotionPhases } from "./draw-queue-provider";
import { useReviewSession } from "./host/review-session";
import {
  LensProgress,
  LensRows,
  ViewedRing,
  lensRowStyles,
  sectionMotionStyle,
} from "./lens-list";
import { diffWorkspaceMarker, scopedDiffMarker } from "./markers.stylex";
import { useReviewDiffFiles } from "./review-diff-files-context";
import { useReviewFindRegistration } from "./review-find";
import { useReviewLenses } from "./review-lenses";
import { useOptionalReviewPanel } from "./review-panel";
import { shellStyles } from "./shell-styles";
import {
  useBottomSheetResize,
  useRightPanelResize,
} from "./side-panel-resizer";
import { useSidebarShowsBoard } from "./sidebar-shows-board";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { useTooltip } from "./use-tooltip";

export function ReviewDiffView({
  scope,
  revealFile,
  restoreFile,
  picker,
}: {
  /** One commit of the board's, picked in the commit picker; else all. */
  scope?: ReviewCommitScope;
  /** The path of a file to scroll to once the diff loads. */
  revealFile?: string;
  /** A saved diff position wins over `revealFile`. */
  restoreFile?: boolean;
  /** The commit picker, over the lenses in this view's own sidebar. */
  picker?: ReactNode;
}) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const cabinetsRef = useRef<HTMLDivElement>(null);

  const sidebarResize = useRightPanelResize({
    side: "left",
    stateKey: "diff-sidebar-width",
    defaultWidth: 320,
    minWidth: 250,
    maxWidth: 800,
    minMainWidth: 320,
    collapsedWidth: 44,
    label: "Resize diff sidebar",
    containerRef: workspaceRef,
  });

  const cabinetsResize = useBottomSheetResize({
    stateKey: "diff-files-height",
    defaultFraction: 0.45,
    minFraction: 0.2,
    maxFraction: 0.8,
    label: "Resize lenses and files",
    containerRef: cabinetsRef,
  });

  const lenses = useReviewLenses();
  // The courier would nudge the lens the tour rings.
  const diffFiles = useReviewDiffFiles();
  const session = useReviewSession();
  const sidebar = useSidebarShowsBoard();

  const sidebarLensList = sidebar
    ? session.bridge.sidebarLensList?.()
    : undefined;

  const lens = scope ? undefined : lenses?.active;

  // The full diff stays mounted behind a commit's, which takes the pick.
  const picked = useOptionalReviewPanel((state) =>
    scope || !state.diffScope ? state.diffReveal : null,
  );

  const [lensList, setLensList] = useState<HTMLDivElement | null>(null);
  const rows = useLensRows(lenses?.lenses ?? []);
  const lensCursor = useContext(LensCursorContext);

  const lensesLive = scopeLive(useContext(AuthoringActivityContext), "lenses");
  const [fullTree, setFullTree] = useState<HTMLDivElement | null>(null);
  const [lensTree, setLensTree] = useState<HTMLDivElement | null>(null);
  const [scopeTree, setScopeTree] = useState<HTMLDivElement | null>(null);

  const fullProgress = useMemo(
    () =>
      lenses?.progress
        ? {
            files: lenses.progress.files.map((file) => ({
              path: file.path,
              ...coverageProgress([file]),
              viewedRanges: coverageSources(file),
              changedRanges: coverageSources(file, file.changed),
              unfoldRanges: lenses.unfoldRanges.filter(
                (source) =>
                  source.file ===
                  (source.side === "base"
                    ? (file.previousPath ?? file.path)
                    : file.path),
              ),
            })),
            changedPaths: lenses.changedPaths,
          }
        : undefined,
    [lenses?.progress, lenses?.changedPaths, lenses?.unfoldRanges],
  );

  const lensProgress = useMemo(
    () =>
      lenses?.progress && lens
        ? {
            files: lenses.progress.files.map((file) => ({
              path: file.path,
              ...coverageProgress([file], lens.ranges),
              viewedRanges: coverageSources(file),
              changedRanges: coverageSources(file, file.changed),
              unfoldRanges: lenses.unfoldRanges.filter(
                (source) =>
                  source.file ===
                  (source.side === "base"
                    ? (file.previousPath ?? file.path)
                    : file.path),
              ),
            })),
            changedPaths: lenses.changedPaths,
          }
        : undefined,
    [lenses?.progress, lenses?.changedPaths, lenses?.unfoldRanges, lens],
  );

  const markFile = (path: string, scoped: boolean) => {
    const file = lenses?.progress?.files.find((file) => file.path === path);

    if (!file || !lenses) return;

    const sources = scoped
      ? lens?.ranges.filter(
          (source) =>
            source.file ===
            (source.side === "base"
              ? (file.previousPath ?? file.path)
              : file.path),
        )
      : coverageSources(file, file.changed);

    void lenses.mark(sources, lenses.stats(sources).state !== "viewed");
  };

  // The lenses stay listed under a picked commit; picking one returns to
  // all commits, since a lens reads the whole range.
  const panel = lenses ? lensPanel(lenses, rows, lens) : undefined;

  const selectLens = (lensId: string | null) => {
    if (lensId === null) lenses?.clear();
    else lenses?.select(lensId);
  };

  const markLens = (lensId: string) => {
    const item = rows.items.find((row) => row.id === lensId);

    if (!item || !lenses) return;
    void lenses.mark(
      item.sources,
      lenses.stats(item.sources).state !== "viewed",
      lens?.id === lensId,
    );
  };

  // Report the lenses to Desktop's sidebar and handle its clicks.
  const reported = sidebar && panel ? JSON.stringify(panel) : undefined;
  const actions = useRef({ selectLens, markLens });

  actions.current = { selectLens, markLens };
  useEffect(() => {
    if (reported) session.bridge.reportSidebarLenses?.(JSON.parse(reported));
  }, [session.bridge, reported]);
  useEffect(() => {
    if (!sidebar) return;

    return session.surface.subscribe((event) => {
      if (event.event === "selectLens")
        actions.current.selectLens(event.lensId);

      if (event.event === "markLens") actions.current.markLens(event.lensId);
    });
  }, [session.surface, sidebar]);

  if (diffFiles.status === "unavailable") return null;

  if (!lenses || !panel)
    return (
      <NativeDiffView
        scope={scope}
        revealFile={picked?.path ?? revealFile}
        restoreFile={!picked && restoreFile}
        revealRequest={picked?.request}
      />
    );

  const untracked = lenses.progress?.untrackedFiles ? (
    <div
      {...stylex.props(styles.hint, styles.untracked)}
      title="Untracked files are not part of the review. git add -N a file to include it."
    >
      {lenses.progress.untrackedFiles} untracked{" "}
      {lenses.progress.untrackedFiles === 1 ? "file" : "files"} not shown
    </div>
  ) : null;

  const trees = (
    <>
      <div
        {...withClass("diff-native-tree", styles.nativeTree)}
        ref={setFullTree}
        style={lens || scope ? { display: "none" } : undefined}
      />
      <div
        {...withClass("diff-native-tree", styles.nativeTree)}
        ref={setLensTree}
        style={!lens || scope ? { display: "none" } : undefined}
      />
      <div
        {...withClass("diff-native-tree", styles.nativeTree)}
        ref={setScopeTree}
        style={!scope ? { display: "none" } : undefined}
      />
      {untracked}
    </>
  );

  // With Desktop's sidebar, the file trees go in its Files section.
  const editors = (
    <div {...stylex.props(styles.editor)}>
      {(sidebar || fullTree) && (
        <NativeDiffView
          treeContainer={sidebar ? undefined : (fullTree ?? undefined)}
          sidebarFileTree={sidebar}
          progress={fullProgress}
          onToggleViewed={
            lenses.readOnly ? undefined : (path) => markFile(path, false)
          }
          onSetViewed={
            lenses.readOnly
              ? undefined
              : (ranges, viewed) => lenses.mark(ranges, viewed)
          }
          hidden={!!lens || !!scope}
          revealFile={lens || scope ? undefined : picked?.path}
          revealRequest={lens || scope ? undefined : picked?.request}
          inWorkspace
        />
      )}
      {/* A picked commit's own diff, its tree in Files; its lines can't be
          marked viewed against the board's range, so it has no marks. */}
      {scope && (sidebar || scopeTree) && (
        <NativeDiffView
          scope={scope}
          revealFile={picked?.path ?? revealFile}
          revealRequest={picked?.request}
          restoreFile={!picked && restoreFile}
          treeContainer={sidebar ? undefined : (scopeTree ?? undefined)}
          sidebarFileTree={sidebar}
          inWorkspace
        />
      )}
      {lens && !scope && (sidebar || lensTree) && (
        <NativeDiffView
          lens={lens}
          revealFile={picked?.path}
          revealRequest={picked?.request}
          treeContainer={sidebar ? undefined : (lensTree ?? undefined)}
          sidebarFileTree={sidebar}
          progress={lensProgress}
          onToggleViewed={
            lenses.readOnly ? undefined : (path) => markFile(path, true)
          }
          onSetViewed={
            lenses.readOnly
              ? undefined
              : (ranges, viewed) => lenses.mark(ranges, viewed)
          }
          inWorkspace
        />
      )}
      {lenses.error && (
        <div {...stylex.props(styles.error)} role="alert">
          {lenses.error}
        </div>
      )}
    </div>
  );

  // With Desktop's sidebar, this view shows only the diff.
  if (sidebar)
    return (
      <div
        {...withClass("diff-workspace", styles.workspace, diffWorkspaceMarker)}
        ref={workspaceRef}
      >
        {editors}
        {/* Draw the agent's cursor in the sidebar's lens list. */}
        {sidebarLensList
          ? createPortal(
              <Courier
                scope="lenses"
                container={sidebarLensList}
                find={lensRowElement}
              />,
              sidebarLensList,
            )
          : null}
      </div>
    );

  // diff-workspace is a marker global.css keys on.
  return (
    <div
      {...withClass("diff-workspace", styles.workspace, diffWorkspaceMarker)}
      ref={workspaceRef}
    >
      {sidebarResize.collapsed && (
        <DiffRail
          rows={rows}
          lenses={lenses}
          activeId={lens?.id}
          viewed={panel.viewed}
          onExpand={sidebarResize.expand}
        />
      )}
      {/* Stays mounted while folded: it hosts the diff views' file trees. */}
      <aside
        {...stylex.props(
          styles.sidebar,
          sidebarResize.collapsed && styles.hidden,
        )}
        style={{ width: sidebarResize.width }}
      >
        <DiffSidebarFolds />
        {picker}
        <LensProgress lenses={panel} />
        <div {...stylex.props(styles.cabinets)} ref={cabinetsRef}>
          <div
            {...withClass("diff-sidebar-lenses", styles.lenses)}
            aria-label="Lenses"
            ref={setLensList}
            style={{ flexBasis: `${(1 - cabinetsResize.fraction) * 100}%` }}
          >
            <div
              {...stylex.props(
                textStyles.eyebrow,
                styles.heading,
                styles.lensesHeading,
              )}
            >
              Lenses
              <MagnifierIcon />
            </div>
            <LensRows lenses={panel} onSelect={selectLens} onMark={markLens} />
            <Courier
              scope="lenses"
              container={lensList}
              find={lensRowElement}
            />
          </div>
          <div
            {...cabinetsResize.separatorProps}
            {...stylex.props(
              buttonStyles.reset,
              shellStyles.sheetResizer,
              styles.cabinetsResizer,
              cabinetsResize.isResizing && styles.resizing,
            )}
          />
          <div {...stylex.props(styles.files)}>
            <div
              {...stylex.props(
                textStyles.eyebrow,
                styles.heading,
                textStyles.truncate,
              )}
            >
              Files <span aria-hidden="true">·</span>{" "}
              {lenses.progress
                ? lens
                  ? `${lensFileCount(lenses, lens)} of ${lenses.progress.files.length}`
                  : lenses.progress.files.length
                : "…"}
            </div>
            {trees}
          </div>
        </div>
      </aside>
      <div
        {...sidebarResize.separatorProps}
        {...stylex.props(
          buttonStyles.reset,
          shellStyles.resizer,
          styles.sidebarResizer,
          sidebarResize.isResizing && styles.resizing,
        )}
      />
      {editors}
    </div>
  );
}

/** How many changed files a lens covers. */
function lensFileCount(lenses: ReviewLenses, lens: ReviewDiffLens): number {
  return new Set(
    lens.ranges.map(
      (source) =>
        lenses.progress?.files.find(
          (file) =>
            source.file ===
            (source.side === "base"
              ? (file.previousPath ?? file.path)
              : file.path),
        )?.path ?? source.file,
    ),
  ).size;
}

type LensRowsShown = { items: LensItem[]; phases: Map<string, MotionPhase> };

/** The lens list's data, for either sidebar. */
function lensPanel(
  lenses: ReviewLenses,
  rows: LensRowsShown,
  active: ReviewDiffLens | undefined,
): ReviewSidebarLenses {
  const counted = !!lenses.progress && lenses.progress.complete !== false;
  const global = lenses.stats();
  const total = global.total.additions + global.total.deletions;
  const remaining = global.remaining.additions + global.remaining.deletions;
  const percent = total ? Math.round((100 * (total - remaining)) / total) : 0;

  return {
    ...(counted && { remaining: global }),
    ...(!!lenses.error && !counted && { unavailable: true }),
    ...(counted && {
      viewed: {
        percent,
        title: `${total - remaining} of ${total} changed lines viewed or folded`,
      },
    }),
    // A board in Trash is read-only: nothing can be marked viewed.
    busy: lenses.busy || lenses.readOnly,
    ...(active && { active: active.id }),
    ...(active &&
      lenses.progress && { activeFiles: lensFileCount(lenses, active) }),
    rows: rows.items.map((item) => {
      const phase = rows.phases.get(item.id);

      return {
        id: item.id,
        title: item.title,
        ...(item.pending && { pending: true }),
        ...(item.unavailable && { unavailable: item.unavailable }),
        // Nothing to filter to, so the row greys out; a lens already
        // selected can still be cleared.
        empty: !item.pending && item.fileCount === 0,
        progress: lenses.stats(item.sources),
        ...(phase && { phase }),
      };
    }),
  };
}

function NativeDiffView({
  scope,
  revealFile,
  restoreFile,
  revealRequest,
  lens,
  treeContainer,
  sidebarFileTree = false,
  progress,
  onToggleViewed,
  onSetViewed,
  hidden = false,
  inWorkspace = false,
}: {
  scope?: ReviewCommitScope;
  revealFile?: string;
  restoreFile?: boolean;
  /** A new value reveals `revealFile` again. */
  revealRequest?: number;
  lens?: ReviewDiffLens;
  treeContainer?: HTMLElement;
  /** The file tree goes in Desktop's sidebar. */
  sidebarFileTree?: boolean;
  progress?: ReviewDiffProgress;
  onToggleViewed?(path: string): void;
  onSetViewed?(
    ranges: ReviewDiffLens["ranges"],
    viewed: boolean,
  ): void | Promise<void>;
  hidden?: boolean;
  /** Fills the workspace's editor column. */
  inWorkspace?: boolean;
}) {
  const session = useReviewSession();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<ReviewDiffViewHandle | null>(null);

  // A lens, commit or save replaces the view; find follows it.
  const [findTarget, setFindTarget] = useState<ReviewDiffViewHandle | null>(
    null,
  );

  // A save in a live checkout changes the comparison; a commit's never does.
  const revision = useReviewDiffFiles().revision;
  const liveRevision = scope ? undefined : revision;

  const current = useRef({ progress, onToggleViewed, onSetViewed, hidden });

  current.current = { progress, onToggleViewed, onSetViewed, hidden };
  useLayoutEffect(() => {
    if (!container) return;
    setError(null);

    try {
      const view = session.bridge.diffView.create({
        container,
        scope,
        lens,
        fileTreeContainer: treeContainer,
        ...(sidebarFileTree && { sidebarFileTree }),
        progress: current.current.progress,
        onToggleViewed: current.current.onToggleViewed
          ? (path) => current.current.onToggleViewed?.(path)
          : undefined,
        onSetViewed: current.current.onSetViewed
          ? (ranges, viewed) => current.current.onSetViewed?.(ranges, viewed)
          : undefined,
      });

      handle.current = view;
      setFindTarget(view);
      view.setFileTreeHidden?.(current.current.hidden);
      const subscription = view.onDidError(setError);

      return () => {
        subscription.dispose();
        view.dispose();
        handle.current = null;
        setFindTarget(null);
      };
    } catch (error) {
      setError(String(error));
    }
  }, [
    container,
    session.bridge.diffView,
    session.config.reviewId,
    scope?.commit,
    lens,
    treeContainer,
    sidebarFileTree,
    liveRevision,
  ]);
  useLayoutEffect(() => {
    handle.current?.setFileTreeHidden?.(hidden);
  }, [hidden]);
  useLayoutEffect(() => {
    if (progress) handle.current?.setProgress?.(progress);
  }, [progress]);
  useLayoutEffect(() => {
    if (revealFile)
      handle.current?.revealFile?.(revealFile, { restore: restoreFile });
  }, [revealFile, restoreFile, revealRequest, container, scope?.commit]);

  const find = useReviewFindRegistration();
  useLayoutEffect(() => {
    if (!container || hidden || !find || !findTarget) return;

    // A preloaded Diff tab stays mounted, hidden, behind other views; only a view on screen answers.
    const shown = () =>
      container.checkVisibility({
        visibilityProperty: true,
        opacityProperty: true,
      });

    return find.register({
      surface: "diff",
      container,
      setFindQuery: async (query) =>
        shown()
          ? ((await findTarget.setFindQuery?.(query)) ?? { matchCount: 0 })
          : { matchCount: 0 },
      async revealFindMatch(index) {
        findTarget.revealFindMatch?.(index);
      },
      clearFind: () => findTarget.clearFind?.(),
      clearActiveFindMatch: () => findTarget.clearActiveFindMatch?.(),
      expand() {},
    });
  }, [container, hidden, find, findTarget]);

  return (
    <>
      <div
        ref={setContainer}
        {...withClass(
          "review-diff-view-host",
          styles.host,
          inWorkspace && styles.hostInWorkspace,
        )}
        style={hidden ? { display: "none" } : undefined}
      />
      <AskCodePins handle={findTarget} commit={scope?.commit} />
      {!hidden && error && (
        <div role="alert" {...stylex.props(styles.viewError)}>
          {error}
        </div>
      )}
    </>
  );
}

/** The lens rows on screen: the current lenses plus a removed one while the
 * lens draw queue erases it, and each row's phase. */
function useLensRows<Item extends { id: string }>(items: Item[]) {
  const phases = useMotionPhases("lenses");
  const previous = useRef(items);
  const shown = withErasedBlocks(items, previous.current, phases);

  useEffect(() => {
    previous.current = shown;
  });

  return { items: shown, phases };
}

type ReviewLenses = NonNullable<ReturnType<typeof useReviewLenses>>;

type LensItem = ReviewLenses["lenses"][number];

function DiffRail({
  rows,
  lenses,
  activeId,
  viewed,
  onExpand,
}: {
  rows: { items: LensItem[]; phases: Map<string, MotionPhase> };
  lenses: ReviewLenses;
  activeId: string | undefined;
  viewed: { percent: number; title: string } | undefined;
  onExpand: () => void;
}) {
  return (
    <nav {...stylex.props(styles.rail)} aria-label="Lens rail">
      <div {...stylex.props(styles.railProgress)}>
        {viewed && <ViewedRing {...viewed} xstyle={styles.railRing} />}
      </div>
      <RailButton label="Show lenses" onClick={onExpand}>
        <MagnifierIcon />
      </RailButton>
      {rows.items.map((item) => (
        <RailLens
          key={item.id}
          item={item}
          lenses={lenses}
          selected={activeId === item.id}
          phase={rows.phases.get(item.id)}
        />
      ))}
      <div {...stylex.props(styles.railFiles)}>
        <RailButton label="Show files" onClick={onExpand}>
          <FileIcon />
        </RailButton>
      </div>
    </nav>
  );
}

function RailLens({
  item,
  lenses,
  selected,
  phase,
}: {
  item: LensItem;
  lenses: ReviewLenses;
  selected: boolean;
  phase: MotionPhase | undefined;
}) {
  const stats = lenses.stats(item.sources),
    empty = !item.pending && item.fileCount === 0;

  // On the name: disabled buttons get no pointer events.
  const tooltip = useTooltip<HTMLSpanElement>(item.title, {
    instant: true,
    detail: item.pending ? undefined : empty ? "0 files" : countsLabel(stats),
  });

  return (
    <button
      {...stylex.props(
        focusStyles.ringInset,
        buttonStyles.reset,
        styles.railLens,
        empty && lensRowStyles.toggleEmpty,
        selected && styles.railLensActive,
        stats.state === "viewed" && !selected && lensRowStyles.faded,
        phase && sectionMotionStyle(phase),
      )}
      aria-label={item.title}
      aria-pressed={selected}
      disabled={!!item.unavailable || (empty && !selected)}
      onClick={() => (selected ? lenses.clear() : lenses.select(item.id))}
    >
      <span ref={tooltip}>
        {item.id === UNCATEGORIZED_LENS_ID
          ? "n/a"
          : item.title.slice(0, 5).trimEnd()}
      </span>
    </button>
  );
}

function countsLabel({ state, remaining }: CoverageProgress) {
  return state === "viewed"
    ? "Viewed"
    : state === "folded"
      ? "Folded"
      : `+${remaining.additions} −${remaining.deletions} remaining`;
}

function RailButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const tooltip = useTooltip(label, { instant: true });

  return (
    <button
      ref={tooltip}
      {...stylex.props(
        focusStyles.ringInset,
        buttonStyles.reset,
        styles.railButton,
      )}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function FileIcon() {
  return (
    <svg
      {...stylex.props(styles.icon)}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 1.75h5l3.25 3.25v9.25H4z" />
      <path d="M9 1.75V5h3.25" />
    </svg>
  );
}

function MagnifierIcon() {
  return (
    <svg
      {...stylex.props(styles.icon)}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4.25" />
      <path d="M9.2 9.2l3.3 3.3" />
    </svg>
  );
}

const inScopedDiff = () => stylex.when.ancestor(":is(*)", scopedDiffMarker);

const styles = stylex.create({
  workspace: {
    display: "flex",
    minHeight: 0,
    height: "100%",
    color: tokens.ink,
    font: `${fontSize.small}/1.5 ${tokens.chromeFont}`,
  },
  // The sidebar is the tray; its right padding holds the divider.
  sidebar: {
    width: "320px",
    minWidth: "250px",
    flexShrink: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    paddingRight: "16px",
    backgroundColor: tokens.tray,
  },
  hidden: {
    display: "none",
  },
  rail: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
    width: "44px",
    paddingBottom: "8px",
    overflowX: "hidden",
    overflowY: "auto",
    backgroundColor: tokens.tray,
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: tokens.rule,
  },
  railProgress: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    flexShrink: 0,
    minHeight: "52px",
    marginBottom: "2px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    color: tokens.inkMuted,
  },
  railRing: {
    flexDirection: "column",
    gap: "3px",
    lineHeight: 1,
  },
  railButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: "28px",
    height: "28px",
    borderRadius: radius.control,
    padding: 0,
    color: tokens.inkMuted,
    cursor: "pointer",
    backgroundColor: { default: tokens.transparent, ":hover": tokens.well },
  },
  // 5ch is five letters in Geist Mono.
  railLens: {
    flexShrink: 0,
    boxSizing: "content-box",
    width: "5ch",
    height: "24px",
    padding: "0 5px",
    borderRadius: radius.pill,
    font: "inherit",
    color: "inherit",
    textAlign: "center",
    whiteSpace: "nowrap",
    cursor: "pointer",
    backgroundColor: { default: tokens.transparent, ":hover": tokens.well },
  },
  railLensActive: {
    color: tokens.ink,
    fontWeight: fontWeight.semibold,
    backgroundColor: tokens.markerTint,
  },
  railFiles: {
    display: "flex",
    justifyContent: "center",
    flexShrink: 0,
    width: "22px",
    marginTop: "2px",
    paddingTop: "8px",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.rule,
  },
  cabinets: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
  },
  // The courier stands on the row being written.
  lenses: {
    flex: "0 0 auto",
    minHeight: 0,
    overflow: "auto",
    position: "relative",
    paddingTop: { default: null, ":has(> .courier)": "14px" },
  },
  files: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  heading: {
    padding: "10px 14px 6px 16px",
  },
  lensesHeading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: "2px",
  },
  hint: {
    padding: "0 14px 6px 16px",
    color: tokens.inkFaint,
    font: `${fontSize.small}/16px ${tokens.chromeFont}`,
  },
  untracked: {
    flexShrink: 0,
    paddingTop: 6,
  },
  nativeTree: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  icon: {
    flexShrink: 0,
    color: tokens.inkMuted,
  },
  // Inside the sidebar, clear of its scrollbar; line on the editor's edge.
  sidebarResizer: {
    flex: "0 0 16px",
    width: "16px",
    minWidth: "16px",
    marginLeft: "-16px",
    backgroundColor: tokens.tray,
    "::before": {
      left: "auto",
      right: 0,
      transform: "none",
    },
    // 3px past the line, short of the editor's controls.
    "::after": {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      right: "-3px",
      content: "''",
    },
  },
  // Overlaps the files pane; the line stays on the pane edge.
  cabinetsResizer: {
    display: "block",
    margin: "-5px 0",
    zIndex: 2,
  },
  resizing: {
    "::before": {
      backgroundColor: tokens.inkFaint,
    },
  },
  editor: {
    position: "relative",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  // The workbench mounts its diff widgets here and sizes them from this box.
  host: {
    position: "relative",
    gridRow: { default: 1, [inScopedDiff()]: 2 },
    minHeight: 0,
    height: "100%",
  },
  hostInWorkspace: {
    flex: 1,
    height: "auto",
  },
  viewError: {
    display: "flex",
    alignItems: "center",
    gridRow: 1,
    alignSelf: "start",
    padding: "0 10px",
    backgroundColor: tokens.surface,
    color: tokens.inkFaint,
    font: `${fontSize.small}/1 ${tokens.chromeFont}`,
  },
  error: {
    padding: "8px 12px",
  },
});
