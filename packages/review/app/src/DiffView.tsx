import { drawMotion } from "@canvas/draw-motion.stylex";
import { fontSize, fontWeight, motion, radius } from "@canvas/scale.stylex";
import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import { CloseIcon, FileIcon, SearchIcon } from "@canvas/ui/icons";
import { textStyles } from "@canvas/ui/text";
import type {
  ReviewCommitScope,
  ReviewDiffLens,
  ReviewDiffProgress,
  ReviewDiffViewHandle,
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
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AskCodePins } from "./ask-code-pins";
import { AuthoringActivityContext } from "./authoring-activity-context";
import { scopeLive } from "./authoring-cursor";
import { Courier, LensCursorContext, lensRowElement } from "./courier";
import { DiffCountHalves, diffCountStyles } from "./diff-count";
import { type MotionPhase, withErasedBlocks } from "./draw-queue";
import { useMotionPhases } from "./draw-queue-provider";
import { drawStyles } from "./draw-styles";
import { useReviewSession } from "./host/review-session";
import {
  diffWorkspaceMarker,
  lensChipMarker,
  scopedDiffMarker,
} from "./markers.stylex";
import { useReviewDiffFiles } from "./review-diff-files-context";
import { useReviewFindRegistration } from "./review-find";
import { useReviewLenses } from "./review-lenses";
import { useOptionalReviewPanel } from "./review-panel";
import { shellStyles } from "./shell-styles";
import {
  useBottomSheetResize,
  useRightPanelResize,
} from "./side-panel-resizer";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
import { ProgressRing } from "./ui/progress-ring";
import { useTooltip } from "./use-tooltip";
import { ViewedButton } from "./viewed-button";

// An empty label shows no tooltip, so only a truncated name gets one.
function LensName({ title, phase }: { title: string; phase?: MotionPhase }) {
  const [truncated, setTruncated] = useState(false);

  const tooltip = useTooltip<HTMLSpanElement>(truncated ? title : "", {
    instant: true,
  });

  const ref = useCallback(
    (name: HTMLSpanElement | null) => {
      if (!name || typeof ResizeObserver === "undefined") return tooltip(name);

      const observer = new ResizeObserver(() =>
          setTruncated(name.scrollWidth > name.clientWidth),
        ),
        disposeTooltip = tooltip(name);

      observer.observe(name);

      return () => {
        observer.disconnect();
        disposeTooltip?.();
      };
    },
    [tooltip],
  );

  return (
    <span
      ref={ref}
      {...stylex.props(
        textStyles.truncate,
        styles.name,
        phase === "relabel" && styles.nameRelabel,
      )}
    >
      {title}
    </span>
  );
}

export function DiffCounts({
  progress,
  xstyle,
}: {
  progress: CoverageProgress;
  xstyle?: stylex.StyleXStyles;
}) {
  const { remaining, total, folded } = progress;

  const tooltip = useTooltip<HTMLSpanElement>(
    `+${remaining.additions} −${remaining.deletions} remaining`,
    {
      instant: true,
      detail: `of +${total.additions} −${total.deletions} total${folded.additions + folded.deletions ? ` · +${folded.additions} −${folded.deletions} folded` : ""}`,
    },
  );

  return (
    <span
      ref={tooltip}
      {...stylex.props(
        diffCountStyles.counts,
        (progress.state === "viewed" || progress.state === "folded") &&
          styles.faded,
        xstyle,
      )}
    >
      {progress.state === "viewed" ? (
        "Viewed"
      ) : progress.state === "folded" ? (
        "Folded"
      ) : (
        <DiffCountHalves
          additions={remaining.additions}
          deletions={remaining.deletions}
        />
      )}
    </span>
  );
}

export function ReviewDiffView({
  scope,
  revealFile,
  restoreFile,
}: {
  scope?: ReviewCommitScope;
  /** The path of a file to scroll to once the diff loads. */
  revealFile?: string;
  /** A saved diff position wins over `revealFile`. */
  restoreFile?: boolean;
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

  if (diffFiles.status === "unavailable") return null;

  if (scope || !lenses)
    return (
      <NativeDiffView
        scope={scope}
        revealFile={picked?.path ?? revealFile}
        restoreFile={!picked && restoreFile}
        revealRequest={picked?.request}
      />
    );
  const global = lenses.stats();
  const total = global.total.additions + global.total.deletions;
  const remaining = global.remaining.additions + global.remaining.deletions;
  const percent = total ? Math.round((100 * (total - remaining)) / total) : 0;

  const viewed =
    lenses.progress && lenses.progress.complete !== false
      ? {
          percent,
          title: `${total - remaining} of ${total} changed lines viewed or folded`,
        }
      : undefined;

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
          viewed={viewed}
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
        <div {...stylex.props(styles.progress)}>
          <span {...stylex.props(styles.progressLabel)}>
            {lenses.error &&
            !(lenses.progress && lenses.progress.complete !== false) ? (
              "Counts unavailable"
            ) : (
              <>
                Remaining{" "}
                {lenses.progress && lenses.progress.complete !== false ? (
                  <DiffCounts progress={global} />
                ) : (
                  <span
                    {...stylex.props(diffCountStyles.counts)}
                    aria-label="Counting changes"
                  >
                    …
                  </span>
                )}
              </>
            )}
          </span>
          {viewed && <ViewedRing {...viewed} />}
        </div>
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
              <SearchIcon xstyle={[iconStyles.chrome, styles.icon]} />
            </div>
            <div {...stylex.props(styles.hint)}>
              Click any lens to filter the diff
            </div>
            {rows.items.map((item) => {
              const selected = lens?.id === item.id,
                stats = lenses.stats(item.sources),
                phase = rows.phases.get(item.id),
                // Nothing to filter to, so the row greys out; a lens already
                // selected can still be cleared.
                empty = !item.pending && item.fileCount === 0;

              return (
                <section
                  key={item.id}
                  {...stylex.props(
                    styles.section,
                    selected && styles.sectionExpanded,
                    phase && sectionMotionStyle(phase),
                  )}
                  data-lens-id={item.id}
                  data-motion={phase}
                >
                  <div
                    {...stylex.props(
                      styles.row,
                      phase === "landing" && drawStyles.rowLanding,
                      phase === "erasing" && drawStyles.rowErasing,
                    )}
                  >
                    <button
                      {...stylex.props(
                        focusStyles.ringInset,
                        buttonStyles.reset,
                        styles.toggle,
                        empty && styles.toggleEmpty,
                        selected && styles.toggleActive,
                        stats.state === "viewed" && !selected && styles.faded,
                      )}
                      aria-pressed={selected}
                      data-tour-target="lens"
                      disabled={!!item.unavailable || (empty && !selected)}
                      onClick={() =>
                        selected ? lenses.clear() : lenses.select(item.id)
                      }
                    >
                      {/* The title and hover wash sit on the chip, not the
                          toggle, so they never stack on the counts' tooltip. */}
                      <span
                        {...stylex.props(
                          lensChipMarker,
                          styles.chip,
                          selected && styles.chipActive,
                        )}
                        data-tour-target="lens-chip"
                        title={
                          item.unavailable ??
                          (selected ? "Clear lens filter" : undefined)
                        }
                      >
                        <LensName title={item.title} phase={phase} />
                        {selected && (
                          <span
                            {...stylex.props(styles.clear)}
                            aria-hidden="true"
                          >
                            <CloseIcon xstyle={iconStyles.inline} />
                          </span>
                        )}
                      </span>
                      {item.pending ? (
                        <span
                          {...stylex.props(
                            diffCountStyles.counts,
                            styles.toggleCounts,
                          )}
                          aria-label="Counting changes"
                        >
                          …
                        </span>
                      ) : empty ? (
                        <span
                          {...stylex.props(
                            diffCountStyles.counts,
                            styles.toggleCounts,
                          )}
                        >
                          0 files
                        </span>
                      ) : (
                        <DiffCounts
                          progress={stats}
                          xstyle={styles.toggleCounts}
                        />
                      )}
                    </button>
                    <ViewedButton
                      progress={stats}
                      disabled={
                        lenses.readOnly ||
                        lenses.busy ||
                        !!item.unavailable ||
                        !!item.pending
                      }
                      label={item.title}
                      onClick={() =>
                        void lenses.mark(
                          item.sources,
                          stats.state !== "viewed",
                          selected,
                        )
                      }
                    />
                  </div>
                </section>
              );
            })}
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
                  ? new Set(
                      lens.ranges.map(
                        (source) =>
                          lenses.progress!.files.find(
                            (file) =>
                              source.file ===
                              (source.side === "base"
                                ? (file.previousPath ?? file.path)
                                : file.path),
                          )?.path ?? source.file,
                      ),
                    ).size + ` of ${lenses.progress.files.length}`
                  : lenses.progress.files.length
                : "…"}
            </div>
            <div
              {...withClass("diff-native-tree", styles.nativeTree)}
              ref={setFullTree}
              style={lens ? { display: "none" } : undefined}
            />
            <div
              {...withClass("diff-native-tree", styles.nativeTree)}
              ref={setLensTree}
              style={!lens ? { display: "none" } : undefined}
            />
            {lenses.progress?.untrackedFiles ? (
              <div
                {...stylex.props(styles.hint, styles.untracked)}
                title="Untracked files are not part of the review. git add -N a file to include it."
              >
                {lenses.progress.untrackedFiles} untracked{" "}
                {lenses.progress.untrackedFiles === 1 ? "file" : "files"} not
                shown
              </div>
            ) : null}
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
      <div {...stylex.props(styles.editor)}>
        {fullTree && (
          <NativeDiffView
            treeContainer={fullTree}
            progress={fullProgress}
            onToggleViewed={
              lenses.readOnly ? undefined : (path) => markFile(path, false)
            }
            onSetViewed={
              lenses.readOnly
                ? undefined
                : (ranges, viewed) => lenses.mark(ranges, viewed)
            }
            hidden={!!lens}
            revealFile={lens ? undefined : picked?.path}
            revealRequest={lens ? undefined : picked?.request}
            inWorkspace
          />
        )}
        {lens && lensTree && (
          <NativeDiffView
            lens={lens}
            revealFile={picked?.path}
            revealRequest={picked?.request}
            treeContainer={lensTree}
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
          <div {...stylex.props(textStyles.error, styles.error)} role="alert">
            {lenses.error}
          </div>
        )}
      </div>
    </div>
  );
}

function NativeDiffView({
  scope,
  revealFile,
  restoreFile,
  revealRequest,
  lens,
  treeContainer,
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

  const current = useRef({ progress, onToggleViewed, onSetViewed });

  current.current = { progress, onToggleViewed, onSetViewed };
  useLayoutEffect(() => {
    if (!container) return;
    setError(null);

    try {
      const view = session.bridge.diffView.create({
        container,
        scope,
        lens,
        fileTreeContainer: treeContainer,
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
    liveRevision,
  ]);
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

function ViewedRing({
  percent,
  title,
  xstyle,
}: {
  percent: number;
  title: string;
  xstyle?: stylex.StyleXStyles;
}) {
  return (
    <span
      {...stylex.props(styles.ring, xstyle)}
      role="progressbar"
      aria-label="Changed lines viewed"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      title={title}
    >
      <ProgressRing percent={percent} size={18} />
      {percent}%
    </span>
  );
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
        <SearchIcon xstyle={[iconStyles.chrome, styles.icon]} />
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
          <FileIcon xstyle={[iconStyles.chrome, styles.icon]} />
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
        empty && styles.toggleEmpty,
        selected && styles.railLensActive,
        stats.state === "viewed" && !selected && styles.faded,
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

// The lens list draws like the document: a new row lands in a slot and wipes
// in, a retitle recomposes the name, a removed row is erased and the list
// closes over it. Reduced motion shows each phase's finished frame. The row's
// wipe and erase share the document's keyframes in draw-styles.ts.

const landSlot = stylex.keyframes({
  "0%": {
    outline: `1px dashed ${tokens.ruleSoft}`,
    outlineOffset: "-1px",
    backgroundColor: tokens.transparent,
  },
  "38%": {
    outline: `1px solid ${tokens.accent}`,
    outlineOffset: "-1px",
    backgroundColor: tokens.markerTint,
  },
  "70%": {
    outline: `1px solid ${tokens.accent}`,
    backgroundColor: tokens.markerTint,
  },
  "100%": {
    outline: `1px solid ${tokens.transparent}`,
    outlineOffset: "-1px",
    backgroundColor: tokens.transparent,
  },
});

const attention = stylex.keyframes({
  from: {
    outlineColor: tokens.transparent,
    backgroundColor: tokens.transparent,
  },
});

const collapse = stylex.keyframes({
  from: { height: "auto", marginBlock: 0 },
  to: { height: 0, marginBlock: 0 },
});

const relabel = stylex.keyframes({
  from: { opacity: 0, clipPath: "inset(0 100% 0 0)" },
  to: { opacity: 1, clipPath: "inset(0 0 0 0)" },
});

const inScopedDiff = () => stylex.when.ancestor(":is(*)", scopedDiffMarker);

const styles = stylex.create({
  workspace: {
    display: "flex",
    minHeight: 0,
    height: "100%",
    color: tokens.ink,
    font: `${fontSize.small}/1.5 ${tokens.fontMono}`,
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
  progress: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexShrink: 0,
    minHeight: "52px",
    padding: "0 14px 0 16px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    color: tokens.inkMuted,
    fontSize: fontSize.small,
  },
  progressLabel: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
  },
  ring: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    fontVariantNumeric: "tabular-nums",
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
    font: `${fontSize.small}/16px ${tokens.fontMono}`,
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
  section: {
    borderBottomWidth: 0,
    borderBottomStyle: "none",
    borderBottomColor: "currentcolor",
  },
  // The section wears no wash; the pressed toggle already says open.
  sectionExpanded: {
    backgroundColor: tokens.transparent,
  },
  row: {
    display: "flex",
    alignItems: "center",
    paddingRight: "10px",
    gap: "7px",
  },
  toggle: {
    display: "flex",
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: "8px",
    textAlign: "left",
    padding: "3px 4px 3px 8px",
    font: "inherit",
    color: "inherit",
    cursor: "pointer",
    backgroundColor: { default: tokens.transparent, ":hover": tokens.well },
  },
  // A lens with no changes (usually Uncategorized) has nothing to filter to.
  toggleEmpty: {
    color: tokens.inkFaint,
    cursor: "default",
    backgroundColor: tokens.transparent,
  },
  toggleActive: {
    color: tokens.ink,
    fontWeight: fontWeight.semibold,
    backgroundColor: tokens.transparent,
  },
  // The filter outranks the viewed fade; the checkbox beside it says viewed.
  faded: {
    opacity: 0.55,
  },
  toggleCounts: {
    marginLeft: "auto",
  },
  // A selected lens is a filter chip around its funnel, name and clear mark;
  // the counts stay outside it so they keep their column.
  chip: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    gap: "8px",
    height: "24px",
    padding: "0 8px",
    borderRadius: radius.pill,
  },
  chipActive: {
    paddingRight: "4px",
    backgroundColor: tokens.markerTint,
  },
  icon: {
    color: tokens.inkMuted,
  },
  name: {
    minWidth: 0,
    flex: "0 1 auto",
    lineHeight: 1.5,
  },
  nameRelabel: {
    animationName: { default: relabel, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.stroke,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "steps(14)",
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  clear: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    borderRadius: radius.pill,
    backgroundColor: {
      default: null,
      [stylex.when.ancestor(":hover", lensChipMarker)]: tokens.markerGlow,
    },
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
    font: `${fontSize.small}/1 ${tokens.fontMono}`,
  },
  error: {
    padding: "8px 12px",
  },
});

const sectionMotion = stylex.create({
  queued: {
    visibility: "hidden",
  },
  landing: {
    animationName: { default: landSlot, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.lensLand,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: motion.enter,
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  attention: {
    outline: `1px solid ${tokens.accent}`,
    outlineOffset: "-1px",
    backgroundColor: tokens.markerTint,
    animationName: { default: attention, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.ring,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: "ease-out",
      [stylex.env.reducedMotion]: "ease",
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
  },
  erasing: {
    overflow: "clip",
    interpolateSize: "allow-keywords",
    animationName: { default: collapse, [stylex.env.reducedMotion]: "none" },
    animationDuration: {
      default: drawMotion.beat,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationTimingFunction: {
      default: motion.enter,
      [stylex.env.reducedMotion]: "ease",
    },
    animationDelay: {
      default: drawMotion.rowErase,
      [stylex.env.reducedMotion]: motion.instant,
    },
    animationFillMode: { default: "both", [stylex.env.reducedMotion]: "none" },
    display: { default: null, [stylex.env.reducedMotion]: "none" },
  },
});

const sectionMotionStyle = (phase: MotionPhase) =>
  phase === "queued" ||
  phase === "landing" ||
  phase === "attention" ||
  phase === "erasing"
    ? sectionMotion[phase]
    : null;
