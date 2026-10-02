import { Button, IconButton } from "@canvas/ui/button";
import { StatusBanner } from "@canvas/ui/status-banner";
import { surfaceStyles } from "@canvas/ui/surface";
import { textStyles } from "@canvas/ui/text";
import {
  type ReviewCanvasRange,
  type ReviewCommitSummary,
  type ReviewDocumentWidthChoice,
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
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AgentSelectionProvider, useAgentSelection } from "./agent-selection";
import { observeAgentTextSelection } from "./agent-text-selection";
import { AskHistoryProvider } from "./ask-history";
import { AskHistoryControl } from "./ask-history-list";
import { AskThreadMarks } from "./ask-marks";
import {
  AuthoringActivityBadge,
  ReviewSurfaceLabel,
} from "./authoring-activity";
import { BugReportControl } from "./bug-report-dialog";
import { controlStyles } from "./controls-styles";
import {
  ReviewDebugSettingsProvider,
  type ReviewNodeTint,
  useReviewDebugSettings,
} from "./debug-settings";
import { DiffLayoutControl } from "./diff-layout-control";
import { ReviewDiffView } from "./DiffView";
import { useDocumentEmbedScroll } from "./document-embed-scroll";
import { documentStyles } from "./document-styles";
import { useReviewSession } from "./host/review-session";
import { DiscordIcon, MarkerUnderline, SettingsSlidersIcon } from "./icons";
import {
  appMarker,
  detailHostMarker,
  documentMarker,
  scopedDiffMarker,
  segmentMarker,
  topbarActionsMarker,
  topbarTabsMarker,
} from "./markers.stylex";
import { ReviewPanelHost } from "./review-components";
import {
  ReviewProvider,
  type ReviewSubmissionOutcome,
  useReview,
} from "./review-context";
import { ReviewCornerAction } from "./review-corner-action";
import { useReviewDiffFiles } from "./review-diff-files-context";
import { ReviewDiffFilesProvider } from "./review-diff-files-context";
import { ReviewDocumentBoundary } from "./review-document-boundary";
import { reportReviewDocumentRenderError } from "./review-document-error-report";
import {
  type ReviewFindHost,
  ReviewFindProvider,
  useReviewFindRegistration,
} from "./review-find";
import { useReviewLenses } from "./review-lenses";
import {
  useReviewPanel,
  useReviewPanelStore,
  useSuppressPanelMotionOnCanvasResume,
} from "./review-panel";
import { type ReviewDiffScope, askShown } from "./review-panel-store";
import { ReviewRootsProvider, useReviewContainer } from "./review-root-context";
import { ReviewStackSelector } from "./review-stack-selector";
import { ReviewToc } from "./review-toc";
import { offeredReviewViews, reviewViewLabel } from "./review-view-route";
import { useReviewViewStateSync } from "./review-view-state";
import { ReviewCommitsView } from "./ReviewCommitsView";
import { ReviewTraceView } from "./ReviewTraceView";
import {
  elevation,
  fontSize,
  fontWeight,
  motion,
  radius,
} from "./scale.stylex";
import { ShareControl } from "./share-control";
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
import { useTutorial } from "./tutorial-context";
import { TutorialExperienceProvider } from "./tutorial-experience";
import { captureUiEvent } from "./ui-telemetry";
import { useReviewTabTelemetry } from "./use-review-tab-telemetry";
import { useTooltip } from "./use-tooltip";
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
  anchors: ReadonlyMap<
    string,
    import("@review/review-document-data").DocumentAnchor
  >;
  documentSoftwareModels: NormalizedSoftwareModel[];
  tocEntries?: import("./review-document-headings").ReviewTocEntry[];
  /** True while the document has no blocks at all, as right after creation. */
  empty?: boolean;
  header: boolean;
  databaseLens: boolean;
  width?: ReviewDocumentWidthChoice;
}

/** A commit-scoped diff stays "commit"; otherwise it follows the reader's
 * structural-diff setting. */
function diffOpenedKind(
  diffScope: ReviewDiffScope | null,
  structuralDiffEnabled: boolean,
): "commit" | "file" | "structural" {
  if (diffScope) return "commit";

  return structuralDiffEnabled ? "structural" : "file";
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
  // The scratchpad is a document and nothing else: no source tree to browse,
  // nothing to share, nothing to dismiss.
  const scratchpad = session.review?.kind === "scratchpad";
  useEffect(() => {
    if (scratchpad) captureUiEvent(session, "scratchpad_opened");
  }, [scratchpad, session]);
  const discordTooltip = useTooltip("Join our Discord community");
  const sourceTreeTooltip = useTooltip("Open full read-only source");
  const panelStore = useReviewPanelStore();
  useSuppressPanelMotionOnCanvasResume(appRef);
  const activePanel = useReviewPanel((state) => state.active);
  const askDocked = useReviewPanel((state) => askShown(state) === "panel");
  const panelMotion = useReviewPanel((state) => state.motion);
  const activeView = useReviewPanel((state) => state.view);
  const diffScope = useReviewPanel((state) => state.diffScope);

  // The full diff stays mounted while another view shows, at the width it
  // had when it was hidden: following the column through a side peek's
  // resize would lay out every editor in it on each step. Shown, it fills the
  // column again and lays out once.
  const diffHostRef = useRef<HTMLDivElement | null>(null);
  const diffPreloaded = activeView !== "diff" || diffScope !== null;
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

  const rightPanelOpen = activePanel !== null || askDocked;

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
  useReviewViewStateSync({ scrollRegionRef, panelStore });

  // Diagrams only read the open tour, so a restored tour whose diagram is
  // no longer in the document would sit in the store unrendered. The
  // document and its tour overlay commit before this effect runs.
  const canvasRoot = useReviewContainer();
  useEffect(() => {
    const { overlayTour, closeOverlayTour } = panelStore.getState();

    if (overlayTour && !canvasRoot?.querySelector(".diagram-tour-overlay")) {
      closeOverlayTour();
    }
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
    reviewFind?.setReviewActive(activeView === "review");
  }, [activeView, reviewFind]);

  const storedList = useTraceList();
  const diffFiles = useReviewDiffFiles();

  // The scratchpad has no repository of its own, so no traces to show.
  const hasTraceSessions =
    !scratchpad &&
    ((session.review?.traces.size ?? 0) > 0 ||
      storedList.status !== "loaded" ||
      storedList.sessions.length > 0);

  const filesTabFileCount = diffScope
    ? diffScope.commit.fileCount
    : diffFiles.status === "loaded"
      ? diffFiles.files.length
      : null;

  const reviewViews = useMemo(
    () =>
      offeredReviewViews({
        hasChangeRange,
        softwareMapEnabled,
        hasTraceSessions,
      }),
    [hasChangeRange, hasTraceSessions, softwareMapEnabled],
  );

  useLayoutEffect(() => {
    panelStore.getState().setAvailableViews(reviewViews);
  }, [panelStore, reviewViews]);

  const lenses = useReviewLenses();

  useReviewTabTelemetry(activeView);

  const tutorial = useTutorial() !== null;

  const tocEntries = document.tocEntries ?? [];

  // Subscribe before the canvas signals ready so a reveal immediately after
  // mounting cannot outrun the listener.
  useLayoutEffect(() => {
    return session.surface.subscribe((event) => {
      if (event.event !== "showReviewView") return;
      const { availableViews, showView } = panelStore.getState();

      if (availableViews.includes(event.view)) showView(event.view);
    });
  }, [panelStore, session.surface]);

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
        <TutorialExperienceProvider
          shellRef={shellRef}
          scrollRegionRef={scrollRegionRef}
        >
          <header {...stylex.props(shellStyles.topbar)}>
            <div {...stylex.props(shellStyles.topbarLeft, topbarTabsMarker)}>
              <div
                {...stylex.props(
                  controlStyles.segmented,
                  controlStyles.segmentedTopbar,
                )}
                role="group"
                aria-label="Session views"
              >
                {reviewViews.map((view) => (
                  <button
                    key={view}
                    type="button"
                    aria-label={
                      view === "map"
                        ? "Map (Experimental)"
                        : reviewViewLabel(view)
                    }
                    aria-pressed={activeView === view}
                    title={view === "map" ? "Map (Experimental)" : undefined}
                    {...withClass(
                      "review-segment",
                      segmentMarker,
                      controlStyles.segment,
                      controlStyles.segmentTopbar,
                      activeView === view && controlStyles.segmentActive,
                      activeView === view && controlStyles.segmentTopbarActive,
                    )}
                    onClick={() => {
                      if (view === "diff")
                        captureUiEvent(session, "diff_opened", {
                          kind: diffOpenedKind(
                            diffScope,
                            Boolean(lenses?.structuralDiffEnabled),
                          ),
                          via: "topbar",
                        });
                      showView(view);
                    }}
                  >
                    {view === "review" ? (
                      <ReviewSurfaceLabel
                        label={scratchpad ? "Scratchpad" : "Whiteboard"}
                        hasContent={document.empty === false}
                        active={activeView === "review"}
                      />
                    ) : (
                      <span>{reviewViewLabel(view)}</span>
                    )}
                    {view === "diff" && filesTabFileCount !== null && (
                      <span
                        {...stylex.props(
                          controlStyles.segmentCount,
                          activeView === view &&
                            controlStyles.segmentCountActive,
                        )}
                      >
                        {filesTabFileCount}
                      </span>
                    )}
                    {view === "commits" && (
                      <span
                        {...stylex.props(
                          controlStyles.segmentCount,
                          activeView === view &&
                            controlStyles.segmentCountActive,
                        )}
                      >
                        {commits.length}
                      </span>
                    )}
                    <MarkerUnderline active={activeView === view} />
                  </button>
                ))}
              </div>
            </div>
            <div
              {...stylex.props(shellStyles.topbarActions, topbarActionsMarker)}
            >
              <div
                {...stylex.props(
                  shellStyles.topbarItem,
                  shellStyles.topbarContext,
                )}
              >
                {!scratchpad && (
                  <Button
                    variant="ghost"
                    xstyle={shellStyles.openSourceTree}
                    aria-label="Source tree ↗"
                    ref={sourceTreeTooltip}
                    onClick={() => {
                      captureUiEvent(session, "source_tree_opened", {
                        via: "topbar",
                      });
                      session.surface.post({
                        name: "openSourceTree",
                        args: {},
                      });
                    }}
                  >
                    <span {...stylex.props(shellStyles.openSourceTreeLabel)}>
                      Source tree
                    </span>
                    <span aria-hidden="true">↗</span>
                  </Button>
                )}
                <AuthoringActivityBadge
                  onLocate={(view) => {
                    if (view === "diff")
                      captureUiEvent(session, "diff_opened", {
                        kind: diffOpenedKind(
                          diffScope,
                          Boolean(lenses?.structuralDiffEnabled),
                        ),
                        via: "locate",
                      });
                    showView(view);
                  }}
                />
              </div>
              <ReviewStackSelector />
              <AskHistoryControl />
              <ShareControl />
              <IconButton
                xstyle={shellStyles.topbarItem}
                ref={discordTooltip}
                aria-label="Join our Discord community"
                onClick={() => {
                  captureUiEvent(session, "discord_clicked", {
                    via: "topbar",
                  });
                  session.surface.post({ name: "joinDiscord", args: {} });
                }}
              >
                <DiscordIcon xstyle={controlStyles.chromeIcon} />
              </IconButton>
              <BugReportControl />
              <ReviewBatonChip outcome={review.submissionOutcome} />
              <DiffLayoutControl />
              {!scratchpad &&
                !review.historicalRevision &&
                !review.submissionOutcome && (
                  <div
                    {...stylex.props(
                      shellStyles.topbarItem,
                      shellStyles.actionsDivider,
                    )}
                  />
                )}
              {!scratchpad &&
              !review.historicalRevision &&
              !review.submissionOutcome ? (
                <ReviewCornerAction />
              ) : null}
            </div>
          </header>
          {banner}
          {activeView === "review" && (
            <ReviewToc
              entries={tocEntries}
              besideHeader={document.header}
              documentWidth={document.width}
            />
          )}
          <section
            ref={scrollRegionRef}
            {...withClass(
              `review-view-region review-view-region--${activeView}`,
              shellStyles.viewRegion,
              activeView === "commits" && shellStyles.commitsRegion,
              activeView === "review" && shellStyles.reviewRegion,
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
                  data-kind={scratchpad ? "scratchpad" : undefined}
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
                    onFocusRequestHandled={
                      panelStore.getState().consumeMapFocus
                    }
                    height="100%"
                    showChrome={false}
                    showFloatingActions={!rightPanelOpen}
                    variant="view"
                  />
                  <MapSettingsControl />
                </div>
              </div>
            )}
            {activeView === "commits" && (
              <ReviewCommitsView
                commits={commits}
                range={range}
                onOpenDiff={(commit, via, file) => {
                  captureUiEvent(session, "commit_diff_opened", { via });
                  panelStore.getState().openCommitDiff({ commit, file });
                }}
              />
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
              <ReviewDiffView />
            </div>
            {activeView === "diff" && diffScope !== null && (
              <div
                {...withClass(
                  "review-diff-view--scoped",
                  shellStyles.diffView,
                  shellStyles.diffViewScoped,
                  scopedDiffMarker,
                )}
              >
                <CommitDiffScopeBar
                  commit={diffScope.commit}
                  onBack={() => showView("commits")}
                />
                <ReviewDiffView
                  scope={{ commit: diffScope.commit.commit }}
                  revealFile={diffScope.file}
                  restoreFile={diffScope.restoreFile}
                />
              </div>
            )}
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
        </TutorialExperienceProvider>
      </main>
      {rightPanelOpen && (
        <div
          {...stylex.props(
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

function CommitDiffScopeBar({
  commit,
  onBack,
}: {
  commit: ReviewCommitSummary;
  onBack: () => void;
}) {
  return (
    <div {...stylex.props(scopeBarStyles.bar)}>
      <button
        type="button"
        {...stylex.props(scopeBarStyles.back)}
        onClick={onBack}
      >
        <span aria-hidden="true">←</span> Commits
      </button>
      <code {...stylex.props(scopeBarStyles.sha)} title={commit.commit}>
        {commit.commit.slice(0, 8)}
      </code>
      <span {...stylex.props(scopeBarStyles.subject)} title={commit.subject}>
        {commit.subject}
      </span>
    </div>
  );
}

const scopeBarStyles = stylex.create({
  bar: {
    display: "flex",
    height: "30px",
    flex: "0 0 30px",
    alignItems: "center",
    gap: "12px",
    padding: "0 12px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
    backgroundColor: tokens.surface,
  },
  back: {
    height: "20px",
    flex: "0 0 auto",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: "transparent",
    color: tokens.accent,
    fontSize: fontSize.micro,
  },
  sha: {
    color: tokens.inkMuted,
    font: `${fontSize.micro} ${tokens.fontMono}`,
  },
  subject: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.ink,
    fontSize: fontSize.small,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

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
  const tooltip = useTooltip<HTMLSpanElement>("Dismissed");

  if (!outcome) return null;

  return (
    <span
      ref={tooltip}
      {...stylex.props(shellStyles.topbarItem, batonStyles.chip)}
    >
      <svg
        {...stylex.props(batonStyles.glyph)}
        viewBox="0 0 16 16"
        width="12"
        height="12"
        aria-hidden="true"
      >
        <rect x="1.6" y="2.6" width="12.8" height="3.4" rx="1" />
        <path d="M3 6v6.2a1.2 1.2 0 0 0 1.2 1.2h7.6A1.2 1.2 0 0 0 13 12.2V6" />
      </svg>
      <span>dismissed</span>
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

  const controlRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Node && controlRef.current?.contains(target))
        return;
      setIsOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener(
        "pointerdown",
        closeOnOutsidePointerDown,
        true,
      );
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={controlRef} {...stylex.props(mapSettingsStyles.control)}>
      {isOpen && (
        <section
          {...stylex.props(surfaceStyles.popover, mapSettingsStyles.popover)}
          aria-label="Map settings"
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
          <div
            {...stylex.props(mapSettingsStyles.tints)}
            role="group"
            aria-label="Node tint"
          >
            <span
              {...stylex.props(
                textStyles.eyebrow,
                mapSettingsStyles.groupLabel,
              )}
            >
              Map node tint
            </span>
            {(["none", "slate", "mineral"] as const).map((option) => (
              <button
                key={option}
                type="button"
                {...stylex.props(
                  mapSettingsStyles.tint,
                  nodeTint === option && mapSettingsStyles.tintActive,
                )}
                aria-pressed={nodeTint === option}
                onClick={() => setNodeTint(option)}
              >
                {nodeTintLabel(option)}
              </button>
            ))}
          </div>
        </section>
      )}
      <IconButton
        size="large"
        xstyle={[
          mapSettingsStyles.trigger,
          isOpen && mapSettingsStyles.triggerActive,
        ]}
        aria-label="Map settings"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <SettingsSlidersIcon />
      </IconButton>
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
      <input
        type="checkbox"
        {...stylex.props(mapSettingsStyles.switchInput)}
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <i
        {...stylex.props(
          mapSettingsStyles.switchTrack,
          checked && mapSettingsStyles.switchTrackOn,
        )}
        aria-hidden="true"
      />
    </label>
  );
}

function nodeTintLabel(tint: ReviewNodeTint) {
  if (tint === "none") return "None";

  return tint === "slate" ? "Slate" : "Mineral";
}

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
    gap: "7px",
    color: tokens.diffRemoved,
    fontFamily: tokens.chromeFont,
    fontSize: tokens.chromeFontSizeSmall,
    fontWeight: tokens.chromeFontWeightStrong,
    lineHeight: 1,
    letterSpacing: tokens.chromeTracking,
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  glyph: {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.4",
  },
});

// Map settings float over the map canvas instead of sitting behind a topbar
// gear, so map-only controls stay with the map.
const mapSettingsStyles = stylex.create({
  control: {
    position: "absolute",
    right: "16px",
    bottom: "16px",
    zIndex: 3,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "8px",
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
    display: "flex",
    width: "268px",
    flexDirection: "column",
  },
  switch: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "14px",
    minHeight: "50px",
    padding: "10px 13px",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.rule,
    color: tokens.ink,
    fontSize: fontSize.ui,
  },
  switchInput: {
    position: "absolute",
    opacity: 0,
    pointerEvents: "none",
  },
  switchTrack: {
    position: "relative",
    flex: "0 0 auto",
    width: "38px",
    height: "22px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.ruleSoft,
    borderRadius: radius.pill,
    backgroundColor: tokens.controlBg,
    "::before": {
      position: "absolute",
      top: "3px",
      left: "3px",
      width: "14px",
      height: "14px",
      borderRadius: radius.pill,
      backgroundColor: tokens.inkFaint,
      transition: `transform ${motion.fast} ${motion.ease}, background ${motion.fast} ${motion.ease}`,
      content: "''",
    },
  },
  switchTrackOn: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accentSoft,
    "::before": {
      backgroundColor: tokens.accent,
      transform: "translateX(16px)",
    },
  },
  tints: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "6px",
    padding: "10px",
  },
  groupLabel: {
    gridColumn: "1 / -1",
    fontFamily: tokens.fontMono,
  },
  tint: {
    minHeight: "32px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: {
      default: tokens.rule,
      ":hover": tokens.accent,
      ":focus-visible": tokens.accent,
    },
    borderRadius: radius.control,
    backgroundColor: {
      default: tokens.tray,
      ":hover": tokens.accentSoft,
      ":focus-visible": tokens.accentSoft,
    },
    color: {
      default: tokens.inkMuted,
      ":hover": tokens.accent,
      ":focus-visible": tokens.accent,
    },
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
    outline: { default: null, ":hover": "none", ":focus-visible": "none" },
  },
  tintActive: {
    borderColor: tokens.accent,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
    outline: "none",
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
