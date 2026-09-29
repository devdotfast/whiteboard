import type {
  ReviewCommitScope,
  ReviewDiffLens,
  ReviewDiffProgress,
  ReviewDiffViewHandle,
} from "@dev.fast/review-protocol";
import type { Lens } from "@review/review-api/diff-lenses";
import {
  type CoverageProgress,
  coverageProgress,
  coverageSources,
} from "@review/viewed-coverage";
import * as stylex from "@stylexjs/stylex";
import {
  type CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AuthoringActivityContext } from "./authoring-activity";
import { scopeLive } from "./authoring-cursor";
import { Courier, LensCursorContext, lensRowElement } from "./courier";
import { compactDiffCount, diffCountStyles } from "./diff-count";
import { type MotionPhase, withErasedBlocks } from "./draw-queue";
import { useMotionPhases } from "./draw-queue-provider";
import { drawStyles } from "./draw-styles";
import { useReviewSession } from "./host/review-session";
import { lensToggleMarker } from "./markers.stylex";
import { useReviewDiffFiles } from "./review-diff-files-context";
import { useReviewLenses } from "./review-lenses";
import { shellStyles } from "./shell-styles";
import {
  useBottomSheetResize,
  useRightPanelResize,
} from "./side-panel-resizer";
import { withClass } from "./stylex-props";
import { tokens } from "./tokens.stylex";
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
      {...stylex.props(styles.name, phase === "relabel" && styles.nameRelabel)}
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
        <>
          <span {...stylex.props(diffCountStyles.added)}>
            +{compactDiffCount(remaining.additions)}
          </span>
          <span {...stylex.props(diffCountStyles.removed)}>
            −{compactDiffCount(remaining.deletions)}
          </span>
        </>
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
  const lens = scope ? undefined : lenses?.active;
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

  if (scope || !lenses)
    return (
      <NativeDiffView
        scope={scope}
        revealFile={revealFile}
        restoreFile={restoreFile}
      />
    );
  const global = lenses.stats();
  const total = global.total.additions + global.total.deletions;
  const remaining = global.remaining.additions + global.remaining.deletions;
  const percent = total ? Math.round((100 * (total - remaining)) / total) : 0;

  // diff-workspace is a marker: the courier and global.css key on it.
  return (
    <div {...withClass("diff-workspace", styles.workspace)} ref={workspaceRef}>
      <aside
        {...stylex.props(styles.sidebar)}
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
          {lenses.progress && lenses.progress.complete !== false && (
            <span
              {...stylex.props(styles.ring)}
              role="progressbar"
              aria-label="Changed lines viewed"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              title={`${total - remaining} of ${total} changed lines viewed or folded`}
            >
              <svg width="18" height="18" viewBox="0 0 20 20">
                <circle
                  {...stylex.props(styles.ringTrack)}
                  cx="10"
                  cy="10"
                  r="7"
                />
                <circle
                  {...stylex.props(styles.ringTrack, styles.ringValue)}
                  cx="10"
                  cy="10"
                  r="7"
                  pathLength="100"
                  strokeDasharray={`${percent} 100`}
                />
              </svg>
              {percent}%
            </span>
          )}
        </div>
        <div {...stylex.props(styles.cabinets)} ref={cabinetsRef}>
          <div
            {...withClass("diff-sidebar-lenses", styles.lenses)}
            aria-label="Lenses"
            ref={setLensList}
            style={{ flexBasis: `${(1 - cabinetsResize.fraction) * 100}%` }}
          >
            <div {...stylex.props(styles.heading, styles.lensesHeading)}>
              Lenses
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
                        lensToggleMarker,
                        styles.toggle,
                        empty && styles.toggleEmpty,
                        selected && styles.toggleActive,
                        stats.state === "viewed" && !selected && styles.faded,
                      )}
                      aria-pressed={selected}
                      disabled={!!item.unavailable || (empty && !selected)}
                      onClick={() =>
                        selected ? lenses.clear() : lenses.select(item.id)
                      }
                    >
                      {/* The title sits on the chip, not the toggle, so it
                          never stacks on the counts' own tooltip. */}
                      <span
                        {...stylex.props(
                          styles.chip,
                          selected && styles.chipActive,
                        )}
                        title={
                          item.unavailable ??
                          (selected ? "Clear lens filter" : undefined)
                        }
                      >
                        <FilterIcon
                          xstyle={
                            selected
                              ? styles.iconActive
                              : empty && styles.iconEmpty
                          }
                        />
                        <LensName title={item.title} phase={phase} />
                        {selected && (
                          <span
                            {...stylex.props(styles.clear)}
                            aria-hidden="true"
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10">
                              <path
                                {...stylex.props(styles.clearMark)}
                                d="M2 2l6 6M8 2L2 8"
                              />
                            </svg>
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
                        lenses.busy || !!item.unavailable || !!item.pending
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
              shellStyles.sheetResizer,
              styles.cabinetsResizer,
              cabinetsResize.isResizing && styles.resizing,
            )}
          />
          <div {...stylex.props(styles.files)}>
            <div {...stylex.props(styles.heading, styles.filesHeading)}>
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
          </div>
        </div>
      </aside>
      <div
        {...sidebarResize.separatorProps}
        {...stylex.props(
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
            onToggleViewed={(path) => markFile(path, false)}
            hidden={!!lens}
            inWorkspace
          />
        )}
        {lens && lensTree && (
          <NativeDiffView
            lens={lens}
            treeContainer={lensTree}
            progress={lensProgress}
            onToggleViewed={(path) => markFile(path, true)}
            inWorkspace
          />
        )}
        {lenses.error && (
          <div {...stylex.props(styles.error)} role="alert">
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
  lens,
  treeContainer,
  progress,
  onToggleViewed,
  hidden = false,
  inWorkspace = false,
}: {
  scope?: ReviewCommitScope;
  revealFile?: string;
  restoreFile?: boolean;
  lens?: ReviewDiffLens;
  treeContainer?: HTMLElement;
  progress?: ReviewDiffProgress;
  onToggleViewed?(path: string): void;
  hidden?: boolean;
  /** Fills the workspace's editor column. */
  inWorkspace?: boolean;
}) {
  const session = useReviewSession();
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<ReviewDiffViewHandle | null>(null);
  // A save in a live checkout changes the comparison; a commit's never does.
  const revision = useReviewDiffFiles().revision;
  const liveRevision = scope ? undefined : revision;

  const current = useRef({ progress, onToggleViewed });

  current.current = { progress, onToggleViewed };
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
      });

      handle.current = view;
      const subscription = view.onDidError(setError);

      return () => {
        subscription.dispose();
        view.dispose();
        handle.current = null;
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
    if (!revealFile) return;

    if (restoreFile)
      handle.current?.revealFile?.(revealFile, { restore: true });
    else handle.current?.revealFile?.(revealFile);
  }, [revealFile, restoreFile, container, scope?.commit]);

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

function FilterIcon({ xstyle }: { xstyle?: stylex.StyleXStyles }) {
  return (
    <svg
      {...stylex.props(styles.icon, xstyle)}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 3h11L9.25 8v4.5l-2.5 1.25V8z" />
    </svg>
  );
}

// The lens list draws like the document: a new row lands in a slot and wipes
// in, a retitle recomposes the name, a removed row is erased and the list
// closes over it. Reduced motion shows each phase's finished frame. The row's
// wipe and erase share the document's keyframes in draw-styles.ts.
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

const REDUCED = "@media (prefers-reduced-motion: reduce)";

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

const styles = stylex.create({
  workspace: {
    display: "flex",
    minHeight: 0,
    height: "100%",
    color: tokens.ink,
    font: `11px/1.5 ${tokens.fontMono}`,
  },
  // The sidebar is the tray.
  sidebar: {
    width: "320px",
    minWidth: "250px",
    flexShrink: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.tray,
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: tokens.rule,
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
    fontSize: "11px",
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
  ringTrack: {
    fill: "none",
    stroke: tokens.well,
    strokeWidth: "2.5",
  },
  ringValue: {
    transform: "rotate(-90deg)",
    transformOrigin: "10px 10px",
    stroke: tokens.accent,
    strokeLinecap: "round",
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
    textTransform: "uppercase",
    padding: "10px 14px 6px 16px",
    color: tokens.inkFaint,
    fontSize: "11px",
    letterSpacing: tokens.wbCaps,
  },
  lensesHeading: {
    paddingBottom: "2px",
  },
  filesHeading: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  hint: {
    padding: "0 14px 6px 16px",
    color: tokens.inkFaint,
    font: `11px/16px ${tokens.fontMono}`,
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
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    textAlign: "left",
    padding: "3px 4px 3px 8px",
    font: "inherit",
    color: "inherit",
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.well },
    outline: { default: null, ":focus-visible": `1px solid ${tokens.accent}` },
    outlineOffset: { default: null, ":focus-visible": "-2px" },
  },
  // A lens with no changes (usually Uncategorized) has nothing to filter to.
  toggleEmpty: {
    color: tokens.inkFaint,
    cursor: "default",
    backgroundColor: "transparent",
  },
  toggleActive: {
    color: tokens.ink,
    fontWeight: 600,
    backgroundColor: "transparent",
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
    borderRadius: "999px",
  },
  chipActive: {
    paddingRight: "4px",
    backgroundColor: tokens.markerTint,
  },
  icon: {
    flexShrink: 0,
    color: tokens.inkMuted,
  },
  iconActive: {
    color: "inherit",
    fill: "currentColor",
  },
  iconEmpty: {
    color: "inherit",
  },
  name: {
    minWidth: 0,
    flex: "0 1 auto",
    lineHeight: 1.5,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  nameRelabel: {
    animationName: { default: relabel, [REDUCED]: "none" },
    animationDuration: { default: "420ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: "steps(14)", [REDUCED]: "ease" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  clear: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    borderRadius: "999px",
    backgroundColor: {
      default: null,
      [stylex.when.ancestor(":hover", lensToggleMarker)]: tokens.markerGlow,
    },
  },
  clearMark: {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.4",
    strokeLinecap: "round",
  },
  // The hit areas overlap adjacent panes; the visible dividers stay one
  // pixel, aligned to the pane edge rather than straddling two pixels.
  sidebarResizer: {
    flex: "0 0 10px",
    margin: "0 -5px",
    zIndex: 2,
    "::before": {
      transform: "none",
    },
  },
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
    gridRow: { default: 1, ":is(.review-diff-view--scoped *)": 2 },
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
    font: `11px/1 ${tokens.fontMono}`,
  },
  error: {
    padding: "8px 12px",
    color: tokens.changeRemoved,
  },
});

const sectionMotion = stylex.create({
  queued: {
    visibility: "hidden",
  },
  landing: {
    animationName: { default: landSlot, [REDUCED]: "none" },
    animationDuration: { default: "520ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: EASE, [REDUCED]: "ease" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  attention: {
    outline: `1px solid ${tokens.accent}`,
    outlineOffset: "-1px",
    backgroundColor: tokens.markerTint,
    animationName: { default: attention, [REDUCED]: "none" },
    animationDuration: { default: "250ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: "ease-out", [REDUCED]: "ease" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
  },
  erasing: {
    overflow: "clip",
    interpolateSize: "allow-keywords",
    animationName: { default: collapse, [REDUCED]: "none" },
    animationDuration: { default: "200ms", [REDUCED]: "0s" },
    animationTimingFunction: { default: EASE, [REDUCED]: "ease" },
    animationDelay: { default: "320ms", [REDUCED]: "0s" },
    animationFillMode: { default: "both", [REDUCED]: "none" },
    display: { default: null, [REDUCED]: "none" },
  },
});

const sectionMotionStyle = (phase: MotionPhase) =>
  phase === "queued" ||
  phase === "landing" ||
  phase === "attention" ||
  phase === "erasing"
    ? sectionMotion[phase]
    : null;
