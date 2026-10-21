import { DiscordIcon } from "@canvas/ui/brand-icons";
import { Button, IconButton, buttonStyles } from "@canvas/ui/button";
import { dividerStyles } from "@canvas/ui/divider";
import { iconStyles } from "@canvas/ui/icon-styles";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ExternalLinkIcon,
  SlidersIcon,
} from "@canvas/ui/icons";
import { menuStyles } from "@canvas/ui/menu";
import {
  OverlayScrollbar,
  overlayScrollbarStyles,
} from "@canvas/ui/overlay-scrollbar";
import { Popover } from "@canvas/ui/popover";
import { StatusBanner } from "@canvas/ui/status-banner";
import { Switch } from "@canvas/ui/switch";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
import {
  type ReviewCanvasRange,
  type ReviewCommitSummary,
  type ReviewDocumentWidthChoice,
  lensDiffFiles,
} from "@dev.fast/review-protocol";
import {
  type SoftwareMapTopologyDiff,
  diffSoftwareMaps,
} from "@review/software-map-topology-diff";
import * as stylex from "@stylexjs/stylex";
import {
  type CSSProperties,
  type ComponentType,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AgentSelectionProvider, useAgentSelection } from "./agent-selection";
import { observeAgentTextSelection } from "./agent-text-selection";
import { AskDesktopSync, useAskPanelHost } from "./ask-dock";
import { AskHistoryProvider } from "./ask-history";
import { AskThreadMarks } from "./ask-marks";
import {
  AuthoringActivityBadge,
  ReviewSurfaceLabel,
} from "./authoring-activity";
import { BugReportControl } from "./bug-report-dialog";
import { CommitPicker } from "./commit-picker";
import { LanguageServerChip } from "./connection-chip";
import { ContentsRail } from "./contents-rail";
import {
  ReviewDebugSettingsProvider,
  type ReviewNodeTint,
  useReviewDebugSettings,
} from "./debug-settings";
import { type DiffFilePicker, useDiffFilePicker } from "./diff-file-picker";
import { DiffLayoutControl } from "./diff-layout-control";
import { DocumentContentsContext } from "./diff-sidebar-folds";
import { ReviewDiffView } from "./DiffView";
import { useDocumentEmbedScroll } from "./document-embed-scroll";
import { documentStyles } from "./document-styles";
import { useReviewSession } from "./host/review-session";
import { useKeepPlace } from "./keep-place";
import {
  appMarker,
  detailHostMarker,
  documentMarker,
  topbarActionsMarker,
  topbarTabsMarker,
} from "./markers.stylex";
import { MissingCheckoutBanner } from "./missing-checkout-banner";
import { usePageBarFold } from "./page-bar-fold";
import { type PageMoreFolded, PageMoreMenu } from "./page-more-menu";
import { shortRef } from "./review-branch-range";
import { ReviewBreadcrumb } from "./review-breadcrumb";
import { ReviewPanelHost } from "./review-components";
import {
  ReviewProvider,
  type ReviewSubmissionOutcome,
  useReview,
} from "./review-context";
import { ReviewCornerAction } from "./review-corner-action";
import { useReviewDiffFiles } from "./review-diff-files-context";
import { ReviewDiffFilesProvider } from "./review-diff-files-context";
import { BoardUpdatedAt, useBoardPlace } from "./review-doc-meta";
import { ReviewDocumentBoundary } from "./review-document-boundary";
import { reportReviewDocumentRenderError } from "./review-document-error-report";
import {
  type ReviewFindHost,
  ReviewFindProvider,
  useReviewFindRegistration,
} from "./review-find";
import {
  scrollToReviewBlock,
  scrollToReviewHeading,
} from "./review-heading-scroll";
import { useReviewLenses } from "./review-lenses";
import {
  useReviewPanel,
  useReviewPanelStore,
  useSuppressPanelMotionOnCanvasResume,
} from "./review-panel";
import {
  type ReviewDiffScope,
  askColumnShown,
  peekShown,
} from "./review-panel-store";
import { ReviewRootsProvider, useReviewContainer } from "./review-root-context";
import {
  StackPill,
  useOpenStackLayer,
  useReviewStack,
} from "./review-stack-selector";
import { offeredReviewViews, reviewViewLabel } from "./review-view-route";
import { useReviewViewStateSync } from "./review-view-state";
import { ReviewTraceView } from "./ReviewTraceView";
import {
  elevation,
  fontSize,
  fontWeight,
  leading,
  radius,
  space,
} from "./scale.stylex";
import { ShareControl, useCanShare } from "./share-control";
import { shellStyles } from "./shell-styles";
import { useRightPanelResize } from "./side-panel-resizer";
import { selectActiveSoftwareMapModel } from "./software-map-selection";
import type {
  NormalizedSoftwareElement,
  NormalizedSoftwareModel,
} from "./software-map/model";
import { SoftwareMapTopologyUnavailable } from "./software-map/software-map-absence";
import { SoftwareMap } from "./software-map/SoftwareMap";
import { withClass } from "./stylex-props";
import { themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";
import { traceStyles } from "./trace-styles";
import { captureUiEvent } from "./ui-telemetry";
import { SegmentedControl, labeledOptions } from "./ui/segmented";
import { useReviewTabTelemetry } from "./use-review-tab-telemetry";
import { useTraceList } from "./use-trace-list";

const DEFAULT_SIDE_PEEK_WIDTH = 560;

const MIN_SIDE_PEEK_WIDTH = 360;

const MAX_SIDE_PEEK_WIDTH = 920;

const MIN_DOCUMENT_WIDTH = 560;

export function App({
  document,
  softwareMap,
  softwareMapEnabled,
  range,
  commits,
  findHost,
}: {
  document: RenderedReviewDocument;
  softwareMap: PublishedSoftwareMap;
  softwareMapEnabled: boolean;
  range: ReviewCanvasRange;
  commits: readonly ReviewCommitSummary[];
  findHost?: ReviewFindHost;
}): ReactElement {
  return (
    <ReviewDiffFilesProvider
      documentKey={[document.routePath, document.filePath].join("\0")}
      revision={range.worktreeRevision}
      unavailable={!!range.sourceUnavailable}
    >
      <ReviewLayout
        document={document}
        softwareMap={softwareMap}
        softwareMapEnabled={softwareMapEnabled}
        range={range}
        commits={commits}
        findHost={findHost}
      />
    </ReviewDiffFilesProvider>
  );
}

export interface PublishedSoftwareMap {
  head: NormalizedSoftwareModel | null;
  base: NormalizedSoftwareModel | null;
}

export interface RenderedReviewDocument {
  render: ComponentType;
  key: string;
  routePath: string;
  filePath: string;
  anchors: ReadonlyMap<string, import("./review-panel-model").PeekAnchor>;
  documentSoftwareModels: NormalizedSoftwareModel[];
  tocEntries?: import("./review-document-headings").ReviewTocEntry[];
  /** True while the document has no blocks at all, as right after creation. */
  empty?: boolean;
  header: boolean;
  databaseLens: boolean;
  width?: ReviewDocumentWidthChoice;
}

function ReviewLayout({
  document,
  softwareMap,
  softwareMapEnabled,
  range,
  commits,
  findHost,
}: {
  document: RenderedReviewDocument;
  softwareMap: PublishedSoftwareMap;
  softwareMapEnabled: boolean;
  range: ReviewCanvasRange;
  commits: readonly ReviewCommitSummary[];
  findHost?: ReviewFindHost;
}): ReactElement {
  const documentRoute = document.routePath;
  const documentRevision = document.key;
  const panelStore = useReviewPanelStore();

  const articleRef = useRef<HTMLElement | null>(null);
  const appRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const scrollRegionRef = useRef<HTMLElement | null>(null);

  const roots = useMemo(
    () => ({ appRef, shellRef, scrollRegionRef, articleRef }),
    [],
  );

  return (
    <ReviewRootsProvider roots={roots}>
      <ReviewFindProvider
        articleRef={articleRef}
        documentKey={documentRevision}
        host={findHost}
      >
        <ReviewDebugSettingsProvider>
          <ReviewProvider
            key={documentRoute}
            documentRoute={documentRoute}
            softwareMapEnabled={softwareMapEnabled}
            openTraceSession={panelStore.getState().openTrace}
          >
            <AskHistoryProvider>
              <AskDesktopSync />
              <AgentSelectionProvider revision={documentRevision}>
                <ReviewLayoutContent
                  appRef={appRef}
                  shellRef={shellRef}
                  scrollRegionRef={scrollRegionRef}
                  articleRef={articleRef}
                  document={document}
                  documentRevision={documentRevision}
                  softwareModels={[
                    ...(softwareMap.head ? [softwareMap.head] : []),
                    ...document.documentSoftwareModels,
                  ]}
                  repoSoftwareMap={softwareMap.head ?? null}
                  baseSoftwareMap={softwareMap.base ?? null}
                  softwareMapTopologyDiff={diffSoftwareMaps(
                    softwareMap.base,
                    softwareMap.head,
                  )}
                  softwareMapEnabled={softwareMapEnabled}
                  range={range}
                  commits={commits}
                />
              </AgentSelectionProvider>
            </AskHistoryProvider>
          </ReviewProvider>
        </ReviewDebugSettingsProvider>
      </ReviewFindProvider>
    </ReviewRootsProvider>
  );
}

function ReviewLayoutContent({
  appRef,
  shellRef,
  scrollRegionRef,
  articleRef,
  document,
  documentRevision,
  softwareModels,
  repoSoftwareMap,
  baseSoftwareMap,
  softwareMapTopologyDiff,
  softwareMapEnabled,
  range,
  commits,
}: {
  appRef: RefObject<HTMLDivElement | null>;
  shellRef: RefObject<HTMLElement | null>;
  scrollRegionRef: RefObject<HTMLElement | null>;
  articleRef: RefObject<HTMLElement | null>;
  document: RenderedReviewDocument;
  documentRevision: string;
  softwareModels: NormalizedSoftwareModel[];
  repoSoftwareMap: NormalizedSoftwareModel | null;
  baseSoftwareMap: NormalizedSoftwareModel | null;
  softwareMapTopologyDiff: SoftwareMapTopologyDiff | null;
  softwareMapEnabled: boolean;
  range: ReviewCanvasRange;
  commits: readonly ReviewCommitSummary[];
}): ReactElement {
  const session = useReviewSession();
  const review = useReview();
  const available = session.review?.available;
  // A remote review keeps Source tree, disabled with the reason.
  const sourceWindows = available?.sourceWindows !== false;
  const sourceTreeShown = sourceWindows || !!session.review?.host;
  const place = useBoardPlace();
  // In Desktop the sidebar's tabs pick the view, and "⋯" holds the rest.
  const sidebarLeads = session.bridge.reportSidebar !== undefined;
  const pageBar = useRef<HTMLElement>(null);
  const fold = usePageBarFold(pageBar, sidebarLeads);
  const canShare = useCanShare();
  const share = useRef<{ open(): void }>(null);
  const contents = useRef<{ open(): void }>(null);
  // Too narrow for the contents rail: the ⋯ menu offers the contents.
  const [contentsRailHidden, setContentsRailHidden] = useState(false);
  const bugReport = useRef<{ open(): void }>(null);

  // The board's scroller, for the overlay scrollbar that replaces its own.
  const [scrollRegion, setScrollRegion] = useState<HTMLElement | null>(null);

  const attachScrollRegion = useCallback(
    (node: HTMLElement | null) => {
      scrollRegionRef.current = node;
      setScrollRegion(node);
    },
    [scrollRegionRef],
  );

  const joinDiscord = () => {
    captureUiEvent(session, "discord_clicked", { via: "topbar" });
    session.surface.post({ name: "joinDiscord", args: {} });
  };

  // Narrowest first out: Share last, after Discord and the bug report.
  const folded: PageMoreFolded[] = [
    ...(fold >= 3 && canShare
      ? [
          {
            id: "share",
            label: "Share…",
            onSelect: () => share.current?.open(),
          },
        ]
      : []),
    ...(fold >= 2
      ? [
          { id: "discord", label: "Join our Discord", onSelect: joinDiscord },
          {
            id: "bug",
            label: "Report a bug…",
            onSelect: () => bugReport.current?.open(),
          },
        ]
      : []),
  ];

  const discordTooltip = useTooltip("Join our Discord community");

  const sourceTreeTooltip = useTooltip(
    sourceWindows
      ? "Open full read-only source"
      : (available?.reason ?? "Source windows are unavailable."),
  );

  const panelStore = useReviewPanelStore();
  useSuppressPanelMotionOnCanvasResume(appRef);
  const peekOpen = useReviewPanel(peekShown);

  // In Desktop, a docked Ask has a panel of its own beside the board.
  const askBeside = !useAskPanelHost();

  const askDocked = useReviewPanel(
    (state) => askBeside && askColumnShown(state),
  );

  const panelMotion = useReviewPanel((state) => state.motion);
  const activeView = useReviewPanel((state) => state.view);
  const pickedScope = useReviewPanel((state) => state.diffScope);

  // Facts come from the board's commits; an unlisted sha scopes nothing.
  const scopedCommit = pickedScope
    ? commits.find((each) => each.commit === pickedScope.commit)
    : undefined;

  const diffScope = scopedCommit ? pickedScope : null;

  // The full diff stays mounted while another view shows, at the width it
  // had when it was hidden: following the column through a side peek's
  // resize would lay out every editor in it on each step. Shown, it fills the
  // column again and lays out once.
  const diffHostRef = useRef<HTMLDivElement | null>(null);
  const diffPreloaded = activeView !== "diff";
  // Built the first time it is shown, then kept for instant returns.
  const [diffOpened, setDiffOpened] = useState(!diffPreloaded);

  if (!diffPreloaded && !diffOpened) setDiffOpened(true);

  const [frozenDiffWidth, setFrozenDiffWidth] = useState<number>();

  useLayoutEffect(() => {
    const width = diffHostRef.current?.getBoundingClientRect().width;

    setFrozenDiffWidth(diffPreloaded && width ? width : undefined);
  }, [diffPreloaded]);

  const frozenDiffStyle =
    diffPreloaded && frozenDiffWidth
      ? { right: "auto", width: `${frozenDiffWidth}px` }
      : undefined;

  const traceSelection = useReviewPanel((state) => state.traceSelection);
  const traceStorage = useReviewPanel((state) => state.traceStorage);
  const mapFocus = useReviewPanel((state) => state.mapFocus);
  const showView = useReviewPanel((state) => state.showView);

  const debugSettings = useReviewDebugSettings();

  // In Desktop the column right of the board holds peeks and Ask alike.
  const rightPanelOpen = askBeside && (peekOpen || askDocked);

  const sidePeekResize = useRightPanelResize({
    stateKey: "side-peek-width",
    defaultWidth: DEFAULT_SIDE_PEEK_WIDTH,
    minWidth: MIN_SIDE_PEEK_WIDTH,
    maxWidth: MAX_SIDE_PEEK_WIDTH,
    maxContainerFraction: 0.5,
    minMainWidth: MIN_DOCUMENT_WIDTH,
    separatorWidth: 10,
    label: "Resize side peek",
    containerRef: appRef,
    active: rightPanelOpen,
  });

  useDocumentEmbedScroll(scrollRegionRef);
  // The board keeps its place as the column beside it opens and closes.
  useKeepPlace(scrollRegionRef);
  useReviewViewStateSync({ scrollRegionRef, panelStore });

  // Diagrams only read the open tour, so a restored tour whose diagram is
  // no longer in the document would sit in the store unrendered. The board
  // editor draws its diagrams a task after the document commits, so look
  // then.
  const canvasRoot = useReviewContainer();
  useEffect(() => {
    const timer = setTimeout(() => {
      const { overlayTour, closeOverlayTour } = panelStore.getState();

      if (overlayTour && !canvasRoot?.querySelector(".diagram-tour-overlay")) {
        closeOverlayTour();
      }
    });

    return () => clearTimeout(timer);
  }, [canvasRoot, documentRevision, panelStore]);

  const hasChangeRange =
    !!range.worktreeRevision || range.baseCommit !== range.headCommit;

  const banner = review.historicalRevision ? (
    <StatusBanner
      action={
        <Button
          onClick={() =>
            void session.surface.post({ name: "openReviewRevision", args: {} })
          }
        >
          Back to latest
        </Button>
      }
    >
      You are viewing an older version of this session.
    </StatusBanner>
  ) : range.sourceUnavailable ? (
    <MissingCheckoutBanner
      worktree={session.review?.targetKind === "worktree"}
    />
  ) : null;

  const selectForAgent = useAgentSelection();
  useEffect(() => {
    selectForAgent(null);
  }, [activeView, diffScope, selectForAgent]);
  useEffect(() => {
    const article = articleRef.current;

    if (activeView !== "review" || !article) return;

    return observeAgentTextSelection(article, selectForAgent);
  }, [activeView, documentRevision, articleRef, selectForAgent]);

  const reviewFind = useReviewFindRegistration();
  useEffect(() => {
    reviewFind?.setSurface(
      activeView === "review"
        ? "review"
        : activeView === "diff"
          ? "diff"
          : null,
    );
  }, [activeView, reviewFind]);

  const storedList = useTraceList();
  const diffFiles = useReviewDiffFiles();

  const activeLens = useReviewLenses()?.active;

  const diffFilePicker = useMemo<DiffFilePicker>(
    () => ({
      files: async () => {
        const commit = panelStore.getState().diffScope?.commit;

        const files = await session.bridge.diffView.files(
          commit ? { commit } : undefined,
        );

        return commit || !activeLens ? files : lensDiffFiles(files, activeLens);
      },
      reveal: (path) => panelStore.getState().revealDiffFile(path),
    }),
    [panelStore, session.bridge.diffView, activeLens],
  );

  useDiffFilePicker(diffFilePicker);

  const hasTraceSessions =
    !session.review?.host &&
    ((session.review?.traces.size ?? 0) > 0 ||
      storedList.status !== "loaded" ||
      storedList.sessions.length > 0);

  const filesTabFileCount = scopedCommit
    ? scopedCommit.fileCount
    : diffFiles.status === "loaded"
      ? diffFiles.files.length
      : null;

  const hasDiff =
    hasChangeRange &&
    !(diffFiles.status === "loaded" && diffFiles.files.length === 0);

  const hasCommits = commits.length > 0;
  const stack = useReviewStack();
  const openStackLayer = useOpenStackLayer();
  const stackRef = useRef({ stack, openStackLayer });
  stackRef.current = { stack, openStackLayer };

  const reviewViews = useMemo(
    () =>
      offeredReviewViews({
        hasDiff,
        softwareMapEnabled,
        hasTraceSessions,
      }),
    [hasDiff, hasTraceSessions, softwareMapEnabled],
  );

  useLayoutEffect(() => {
    panelStore.getState().setAvailableViews(reviewViews);
  }, [panelStore, reviewViews]);

  const lenses = useReviewLenses();

  useReviewTabTelemetry(activeView);

  const tocEntries = document.tocEntries ?? [];

  // The Diff view's folded Contents opens the document at a heading.
  const documentContents = useMemo(
    () => ({
      entries: tocEntries,
      open: (headingId: string) => {
        panelStore.getState().showView("review");
        revealWhenDrawn(() =>
          scrollToReviewHeading(
            headingId,
            articleRef.current,
            scrollRegionRef.current,
          ),
        );
      },
    }),
    [tocEntries, panelStore, articleRef, scrollRegionRef],
  );

  // Report the view and change counts to Desktop's sidebar.
  const lensStats = lenses?.progress ? lenses.stats() : undefined;

  // The change's counts come from the diff, which can take seconds; the
  // board's view is reported at once, and the sidebar keeps
  // its Lenses and Files counts until these arrive.
  const countsPending =
    hasChangeRange &&
    !!lenses &&
    !lenses.error &&
    (lensStats === undefined || filesTabFileCount === null);

  useEffect(() => {
    session.bridge.reportSidebar?.({
      view: activeView,
      ...(countsPending && { countsPending }),
      ...(hasCommits && {
        commits: commits.map(
          ({ commit, subject, author, authoredAt, additions, deletions }) => ({
            commit,
            subject,
            author,
            authoredAt,
            additions,
            deletions,
          }),
        ),
        compare: `${shortRef(range.baseRef || range.baseCommit)} ← ${shortRef(range.headRef || range.headCommit)}`,
      }),
      ...(diffScope && { commit: diffScope.commit }),
      ...(stack.layers.length > 1 && { stack }),
      ...(hasChangeRange && lenses && { lenses: lenses.authored.length }),
      ...(hasChangeRange &&
        filesTabFileCount !== null &&
        lensStats && {
          files: {
            count: filesTabFileCount,
            // A picked commit's own changes; else the board's.
            additions: scopedCommit
              ? scopedCommit.additions
              : lensStats.total.additions,
            deletions: scopedCommit
              ? scopedCommit.deletions
              : lensStats.total.deletions,
            ...(lenses?.progress?.untrackedFiles && {
              untracked: lenses.progress.untrackedFiles,
            }),
          },
        }),
    });
  }, [
    session.bridge,
    countsPending,
    activeView,
    hasChangeRange,
    lenses,
    filesTabFileCount,
    lensStats?.total.additions,
    lensStats?.total.deletions,
    lenses?.progress?.untrackedFiles,
    hasCommits,
    commits,
    range.baseRef,
    range.baseCommit,
    range.headRef,
    range.headCommit,
    diffScope,
    stack,
  ]);

  useEffect(() => {
    if (pickedScope && !scopedCommit) panelStore.getState().pickCommit(null);
  }, [pickedScope, scopedCommit, panelStore]);

  // Subscribe before the canvas signals ready so a reveal immediately after
  // mounting cannot outrun the listener.
  useLayoutEffect(() => {
    let stopReveal: (() => void) | undefined;

    const unsubscribe = session.surface.subscribe((event) => {
      if (event.event === "revealBlock") {
        stopReveal?.();
        panelStore.getState().showView("review");
        stopReveal = revealWhenDrawn(() =>
          scrollToReviewBlock(
            event.blockId,
            articleRef.current,
            scrollRegionRef.current,
          ),
        );

        return;
      }

      if (event.event === "openStackLayer") {
        const { stack, openStackLayer } = stackRef.current;
        const layer = stack.layers.find((each) => each.branch === event.branch);

        if (layer) void openStackLayer(layer, event.active);

        return;
      }

      if (event.event === "pickCommit") {
        panelStore
          .getState()
          .pickCommit(event.commit ? { commit: event.commit } : null);

        return;
      }

      if (event.event !== "showReviewView") return;

      const {
        availableViews,
        showView,
        diffScope: scope,
      } = panelStore.getState();

      const view = event.view;

      if (!availableViews.includes(view)) return;

      // Desktop's sidebar tabs open the diff in place of the strip.
      if (view === "diff" && event.reviewId)
        captureUiEvent(session, "diff_opened", {
          kind: scope ? "commit" : "structural",
          via: "sidebar",
        });
      showView(view);
    });

    return () => {
      stopReveal?.();
      unsubscribe();
    };
  }, [panelStore, session, articleRef, scrollRegionRef]);

  const activeSoftwareMapSource = useMemo(
    () =>
      selectActiveSoftwareMapModel({
        softwareModels,
        focusElementPath: mapFocus?.elementPath,
      }),
    [mapFocus?.elementPath, softwareModels],
  );

  const activeSoftwareMap = useMemo(
    () =>
      applySoftwareMapTopologyStatuses(
        activeSoftwareMapSource,
        softwareMapTopologyDiff,
      ),
    [activeSoftwareMapSource, softwareMapTopologyDiff],
  );

  // SAFETY: `--side-peek-width` is a CSS custom property, which React forwards
  // to style.setProperty; the CSSProperties typings only omit custom names.
  const appStyle = rightPanelOpen
    ? ({
        "--side-peek-width": `${sidePeekResize.width}px`,
      } as CSSProperties)
    : undefined;

  const appClassName = [
    "review-app",
    `review-app--theme-${debugSettings.theme}`,
    `review-app--tint-${debugSettings.nodeTint}`,
  ].join(" ");

  return (
    <div
      ref={appRef}
      {...withClass(
        appClassName,
        appMarker,
        themeStyles.vars,
        themeStyles.app,
        debugSettings.theme === "light" && themeStyles.light,
        rightPanelOpen && shellStyles.appPeekOpen,
        sidePeekResize.isResizing && shellStyles.appResizing,
        panelMotion === "restored" && shellStyles.appRestoredPanel,
      )}
      style={appStyle}
      data-peek-open={rightPanelOpen || undefined}
      data-document-header={document.header || undefined}
      data-database-lens={document.databaseLens || undefined}
      data-document-width={document.width}
    >
      <main
        ref={shellRef}
        {...withClass(
          "review-document-shell",
          shellStyles.documentShell,
          !!banner && shellStyles.documentShellBanner,
        )}
      >
        <header
          ref={pageBar}
          {...stylex.props(
            shellStyles.topbar,
            sidebarLeads && shellStyles.pageBar,
          )}
        >
          <div
            {...stylex.props(
              shellStyles.topbarLeft,
              topbarTabsMarker,
              sidebarLeads && shellStyles.pageBarLeft,
            )}
          >
            {session.review ? (
              <ReviewBreadcrumb
                place={place}
                reviewId={session.review.reviewId}
                counted={fold < 1}
                status={<BoardUpdatedAt />}
              />
            ) : null}
            {sidebarLeads ? null : (
              <SegmentedControl
                label="Session views"
                variant="topbar"
                value={activeView}
                options={reviewViews.map((view) => ({
                  value: view,
                  "aria-label":
                    view === "map"
                      ? "Map (Experimental)"
                      : reviewViewLabel(view),
                  title: view === "map" ? "Map (Experimental)" : undefined,
                  label:
                    view === "review" ? (
                      <ReviewSurfaceLabel
                        hasContent={document.empty === false}
                        active={activeView === "review"}
                      />
                    ) : (
                      <span>{reviewViewLabel(view)}</span>
                    ),
                  count:
                    view === "diff"
                      ? (filesTabFileCount ?? undefined)
                      : undefined,
                }))}
                onChange={(view) => {
                  if (view === "diff")
                    captureUiEvent(session, "diff_opened", {
                      kind: diffScope ? "commit" : "structural",
                      via: "topbar",
                    });
                  showView(view);
                }}
              />
            )}
          </div>
          <div
            {...stylex.props(
              shellStyles.topbarActions,
              topbarActionsMarker,
              sidebarLeads && shellStyles.pageBarActions,
            )}
          >
            <div
              {...stylex.props(
                shellStyles.topbarItem,
                shellStyles.topbarContext,
              )}
            >
              {sidebarLeads || !sourceTreeShown ? null : (
                <Button
                  variant="ghost"
                  xstyle={shellStyles.openSourceTree}
                  aria-label="Source tree"
                  disabled={!sourceWindows}
                  ref={sourceTreeTooltip}
                  onClick={() => {
                    captureUiEvent(session, "source_tree_opened", {
                      via: "topbar",
                    });
                    // The desktop already showed why it failed.
                    session.surface
                      .post({ name: "openSourceTree", args: {} })
                      .catch(() => undefined);
                  }}
                >
                  <span {...stylex.props(shellStyles.openSourceTreeLabel)}>
                    Source tree
                  </span>
                  <ExternalLinkIcon xstyle={iconStyles.inline} />
                </Button>
              )}
              {session.review?.available?.pending && session.review.host ? (
                <LanguageServerChip host={session.review.host} />
              ) : null}
              <AuthoringActivityBadge
                onLocate={(view) => {
                  if (view === "diff")
                    captureUiEvent(session, "diff_opened", {
                      kind: diffScope ? "commit" : "structural",
                      via: "locate",
                    });
                  showView(view);
                }}
              />
            </div>
            <ShareControl folded={fold >= 3} handle={share} />
            {fold >= 2 ? null : (
              <IconButton
                xstyle={shellStyles.topbarItem}
                ref={discordTooltip}
                aria-label="Join our Discord community"
                data-page-bar-fold="chat"
                onClick={joinDiscord}
              >
                <DiscordIcon xstyle={iconStyles.chrome} />
              </IconButton>
            )}
            <BugReportControl folded={fold >= 2} handle={bugReport} />
            <ReviewBatonChip outcome={review.submissionOutcome} />
            <DiffLayoutControl />
            {sidebarLeads ? (
              <PageMoreMenu
                views={reviewViews
                  .filter((view) => view === "trace" || view === "map")
                  .map((view) => ({
                    view,
                    label:
                      view === "map"
                        ? "Map (Experimental)"
                        : reviewViewLabel(view),
                  }))}
                onShowView={showView}
                folded={folded}
                onOpenContents={
                  activeView === "review" &&
                  contentsRailHidden &&
                  tocEntries.length > 0
                    ? () => contents.current?.open()
                    : undefined
                }
              />
            ) : (
              <>
                {!review.historicalRevision && !review.submissionOutcome && (
                  <div
                    aria-hidden="true"
                    {...stylex.props(dividerStyles.vertical)}
                  />
                )}
                {!review.historicalRevision && !review.submissionOutcome ? (
                  <ReviewCornerAction />
                ) : null}
              </>
            )}
          </div>
        </header>
        {banner}
        <section
          ref={attachScrollRegion}
          // The contents rail returns focus here when its card closes.
          tabIndex={-1}
          {...withClass(
            `review-view-region review-view-region--${activeView}`,
            shellStyles.viewRegion,
            activeView === "review" && shellStyles.reviewRegion,
            activeView === "review" && overlayScrollbarStyles.scroller,
            activeView === "review" &&
              tocEntries.length > 0 &&
              shellStyles.reviewRegionRail,
            activeView === "trace" && traceStyles.region,
          )}
        >
          <div
            {...withClass(
              "review-document-view",
              shellStyles.documentView,
              activeView !== "review" && shellStyles.hidden,
            )}
            hidden={activeView !== "review"}
          >
            <>
              <article
                ref={articleRef}
                {...withClass(
                  "review-document",
                  documentStyles.article,
                  documentMarker,
                  rightPanelOpen && documentStyles.articlePeekOpen,
                )}
              >
                <ReviewDocumentBoundary
                  key={documentRevision}
                  session={session}
                  revision={documentRevision}
                  onError={(_revision, error) =>
                    reportReviewDocumentRenderError(session, error)
                  }
                >
                  <document.render />
                </ReviewDocumentBoundary>
              </article>
              <AskThreadMarks
                articleRef={articleRef}
                revision={documentRevision}
              />
            </>
          </div>
          {softwareMapEnabled && activeView === "map" && (
            <div
              {...withClass(
                "review-map-view",
                shellStyles.mapView,
                mapViewStyles.view,
              )}
            >
              <div
                {...stylex.props(
                  shellStyles.mapCanvasShell,
                  mapViewStyles.canvasShell,
                )}
              >
                <SoftwareMapTopologyUnavailable
                  repoSoftwareMap={repoSoftwareMap}
                  baseSoftwareMap={baseSoftwareMap}
                  baseRef={review.resolvedBaseRef ?? undefined}
                  headRef={review.resolvedHeadRef ?? undefined}
                />
                <SoftwareMap
                  model={activeSoftwareMap ?? undefined}
                  pinnedData={
                    activeSoftwareMapSource
                      ? session.softwareMapData?.(activeSoftwareMapSource)
                      : undefined
                  }
                  focusRequest={mapFocus?.pending ? mapFocus : null}
                  onFocusRequestHandled={panelStore.getState().consumeMapFocus}
                  height="100%"
                  showChrome={false}
                  showFloatingActions={!rightPanelOpen}
                  variant="view"
                />
                <MapSettingsControl />
              </div>
            </div>
          )}
          <div
            ref={diffHostRef}
            aria-hidden={diffPreloaded}
            {...stylex.props(
              shellStyles.diffView,
              diffPreloaded && shellStyles.diffViewPreloaded,
            )}
            style={frozenDiffStyle}
          >
            {diffOpened && (
              <DocumentContentsContext.Provider value={documentContents}>
                <ReviewDiffView
                  scope={diffScope ? { commit: diffScope.commit } : undefined}
                  revealFile={diffScope?.file}
                  restoreFile={diffScope?.restoreFile}
                  picker={
                    // Desktop's sidebar has its own, over its Lenses.
                    sidebarLeads ? undefined : (
                      <CommitPicker
                        commits={commits}
                        leading={
                          <StackPill
                            stack={stack}
                            size="bar"
                            onOpen={(layer, active) =>
                              void openStackLayer(layer, active)
                            }
                          />
                        }
                        selected={diffScope?.commit}
                        onPick={(sha) =>
                          panelStore
                            .getState()
                            .pickCommit(sha ? { commit: sha } : null)
                        }
                      />
                    )
                  }
                />
              </DocumentContentsContext.Provider>
            )}
          </div>
          {activeView === "trace" && (
            <ReviewTraceView
              selection={traceSelection}
              onSelect={panelStore.getState().selectTrace}
              storage={traceStorage}
              onSelectStorage={panelStore.getState().selectTraceStorage}
              storedList={storedList}
            />
          )}
        </section>
        {activeView === "review" && (
          <OverlayScrollbar scroller={scrollRegion} />
        )}
        {activeView === "review" && (
          <ContentsRail
            entries={tocEntries}
            articleRef={articleRef}
            scrollRegionRef={scrollRegionRef}
            barAnchor={pageBar}
            handle={contents}
            onHiddenChange={setContentsRailHidden}
          />
        )}
      </main>
      {rightPanelOpen && (
        <div
          {...stylex.props(
            buttonStyles.reset,
            shellStyles.resizer,
            shellStyles.peekResizer,
            shellStyles.resizerGrabPanel,
            askDocked && shellStyles.peekResizerTray,
            sidePeekResize.isResizing && shellStyles.peekResizerActive,
          )}
          {...sidePeekResize.separatorProps}
        />
      )}
      <div {...stylex.props(shellStyles.detailHost, detailHostMarker)}>
        <ReviewPanelHost />
      </div>
    </div>
  );
}

/**
 * Reports where the baton sits after the reader acts. It renders nothing while
 * the review is simply waiting: the corner action already says what to do, and
 * a standing "awaiting your review" chip was noise on every review.
 */
function ReviewBatonChip({
  outcome,
}: {
  outcome: ReviewSubmissionOutcome | null;
}): ReactElement | null {
  const tooltip = useTooltip<HTMLSpanElement>("Deleted");

  if (!outcome) return null;

  return (
    <span
      ref={tooltip}
      {...stylex.props(shellStyles.topbarItem, batonStyles.chip)}
    >
      <ArchiveIcon xstyle={iconStyles.inline} />
      <span>deleted</span>
    </span>
  );
}

/**
 * Map settings, floating over the map canvas. They used to sit behind a topbar
 * gear that held nothing else, which put map-only controls in front of readers
 * who never open the map.
 */
function MapSettingsControl(): ReactElement {
  const {
    showModifiedOnly,
    setShowModifiedOnly,
    showRemovedNodes,
    setShowRemovedNodes,
    nodeTint,
    setNodeTint,
  } = useReviewDebugSettings();

  const trigger = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div {...stylex.props(mapSettingsStyles.control)}>
      <IconButton
        ref={trigger}
        size="large"
        xstyle={[
          mapSettingsStyles.trigger,
          isOpen && mapSettingsStyles.triggerActive,
        ]}
        aria-label="Map settings"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <SlidersIcon />
      </IconButton>
      {isOpen && (
        <Popover
          anchor={trigger}
          onDismiss={() => setIsOpen(false)}
          role="dialog"
          aria-label="Map settings"
          xstyle={[
            menuStyles.popover,
            menuStyles.above,
            menuStyles.end,
            mapSettingsStyles.popover,
          ]}
        >
          <DebugSwitch
            label="Show modified nodes only"
            checked={showModifiedOnly}
            onChange={setShowModifiedOnly}
          />
          <DebugSwitch
            label="Show removed nodes"
            checked={showRemovedNodes}
            onChange={setShowRemovedNodes}
          />
          <div {...stylex.props(mapSettingsStyles.tints)}>
            <span
              {...stylex.props(
                textStyles.eyebrow,
                mapSettingsStyles.groupLabel,
              )}
            >
              Map node tint
            </span>
            <SegmentedControl
              label="Node tint"
              value={nodeTint}
              options={labeledOptions(NODE_TINT_LABELS)}
              onChange={setNodeTint}
            />
          </div>
        </Popover>
      )}
    </div>
  );
}

function DebugSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <label {...stylex.props(mapSettingsStyles.switch)}>
      <span>{label}</span>
      <Switch
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

const NODE_TINT_LABELS: Record<ReviewNodeTint, string> = {
  none: "None",
  slate: "Slate",
  mineral: "Mineral",
};

export function applySoftwareMapTopologyStatuses(
  model: NormalizedSoftwareModel | undefined,
  diff: SoftwareMapTopologyDiff | null,
): NormalizedSoftwareModel | undefined {
  if (!model || !diff) return model;

  const elements = model.elements.map((element): NormalizedSoftwareElement => {
    const topologyStatus = diff.elementStatusByPath[element.path];

    return topologyStatus
      ? { ...element, changeStatus: topologyStatus }
      : element;
  });

  return {
    ...model,
    elements,
    elementsByPath: new Map(elements.map((element) => [element.path, element])),
  };
}

const batonStyles = stylex.create({
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s8,
    color: tokens.diffRemoved,
    fontFamily: tokens.chromeFont,
    fontSize: tokens.chromeFontSizeSmall,
    fontWeight: tokens.chromeFontWeightStrong,
    lineHeight: leading.none,
    letterSpacing: tokens.chromeTracking,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
});

// Map settings float over the map canvas instead of sitting behind a topbar
// gear, so map-only controls stay with the map.
const mapSettingsStyles = stylex.create({
  control: {
    position: "absolute",
    right: space.s16,
    bottom: space.s16,
    zIndex: 3,
  },
  // A floating corner control, so it keeps a border and lifts off the map.
  trigger: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: { default: tokens.ruleSoft, ":hover": tokens.accent },
    borderRadius: radius.surface,
    backgroundColor: tokens.surfaceRaised,
    boxShadow: elevation.popover,
  },
  triggerActive: {
    borderColor: tokens.accent,
    color: tokens.ink,
  },
  popover: {
    gap: 0,
    width: "268px",
    padding: 0,
  },
  switch: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s14,
    minHeight: "50px",
    padding: `${space.s10} ${space.s12}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    color: tokens.ink,
    fontSize: fontSize.ui,
  },
  tints: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s6,
    padding: space.s10,
  },
  groupLabel: {
    fontFamily: tokens.chromeFont,
  },
});

const mapViewStyles = stylex.create({
  view: {
    backgroundColor: tokens.bg,
  },
  canvasShell: {
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: 0,
    backgroundColor: tokens.bg,
    boxShadow: "none",
  },
});

/** Tries each frame until `scroll` succeeds, as once the document shows the
 * block. Gives up after 5s, since the block may not exist in this version. */
function revealWhenDrawn(scroll: () => boolean): () => void {
  const deadline = Date.now() + 5000;
  let frame = 0;

  const attempt = () => {
    if (scroll()) return;

    if (Date.now() < deadline) frame = requestAnimationFrame(attempt);
  };

  attempt();

  return () => cancelAnimationFrame(frame);
}
