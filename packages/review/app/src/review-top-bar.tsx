import { DiscordIcon } from "@canvas/ui/brand-icons";
import { Button, IconButton } from "@canvas/ui/button";
import { dividerStyles } from "@canvas/ui/divider";
import { iconStyles } from "@canvas/ui/icon-styles";
import { ArchiveIcon, ExternalLinkIcon } from "@canvas/ui/icons";
import { useTooltip } from "@canvas/ui/tooltip";
import type { ReviewCommitSummary } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useRef } from "react";

import {
  AuthoringActivityBadge,
  ReviewSurfaceLabel,
} from "./authoring-activity";
import { BugReportControl } from "./bug-report-dialog";
import { LanguageServerChip } from "./connection-chip";
import { useReviewDebugSettings } from "./debug-settings";
import { DiffLayoutControl } from "./diff-layout-control";
import { useReviewSession } from "./host/review-session";
import {
  appMarker,
  topbarActionsMarker,
  topbarTabsMarker,
} from "./markers.stylex";
import { usePageBarFold } from "./page-bar-fold";
import { type PageMoreFolded, PageMoreMenu } from "./page-more-menu";
import { ReviewBreadcrumb } from "./review-breadcrumb";
import { type ReviewSubmissionOutcome, useReview } from "./review-context";
import { ReviewCornerAction } from "./review-corner-action";
import { useDiffScope } from "./review-diff-files-context";
import { BoardUpdatedAt, useBoardPlace } from "./review-doc-meta";
import { useReviewPanel } from "./review-panel";
import { reviewViewLabel } from "./review-view-route";
import { leading, space } from "./scale.stylex";
import { ShareControl, useCanShare } from "./share-control";
import { shellStyles } from "./shell-styles";
import { themeClass, themeStyles } from "./theme-styles";
import { tokens } from "./tokens.stylex";
import { captureUiEvent } from "./ui-telemetry";
import { SegmentedControl } from "./ui/segmented";
import { useWhiteboardData } from "./whiteboard";

const noCommits: readonly ReviewCommitSummary[] = [];

export function ReviewTopBar(): ReactElement {
  const data = useWhiteboardData();
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
  const bugReport = useRef<{ open(): void }>(null);
  const debugSettings = useReviewDebugSettings();
  const activeView = useReviewPanel((state) => state.view);
  const reviewViews = useReviewPanel((state) => state.availableViews);
  const showView = useReviewPanel((state) => state.showView);
  const openContents = useReviewPanel((state) => state.openContents);

  const contentsRailHidden = useReviewPanel(
    (state) => state.contentsRailHidden,
  );

  const { diffScope, fileCount } = useDiffScope(data.commits ?? noCommits);

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

  const showDiff = (via: "topbar" | "locate") =>
    captureUiEvent(session, "diff_opened", {
      kind: diffScope ? "commit" : "structural",
      via,
    });

  const settled = !review.historicalRevision && !review.submissionOutcome;

  return (
    <header
      ref={pageBar}
      {...stylex.props(
        appMarker,
        themeStyles.vars,
        themeClass(debugSettings.theme),
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
                view === "map" ? "Map (Experimental)" : reviewViewLabel(view),
              title: view === "map" ? "Map (Experimental)" : undefined,
              label:
                view === "review" ? (
                  <ReviewSurfaceLabel
                    hasContent={data.snapshot.document.length > 0}
                    active={activeView === "review"}
                  />
                ) : (
                  <span>{reviewViewLabel(view)}</span>
                ),
              count: view === "diff" ? (fileCount ?? undefined) : undefined,
            }))}
            onChange={(view) => {
              if (view === "diff") showDiff("topbar");
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
          {...stylex.props(shellStyles.topbarItem, shellStyles.topbarContext)}
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
              if (view === "diff") showDiff("locate");
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
                  view === "map" ? "Map (Experimental)" : reviewViewLabel(view),
              }))}
            onShowView={showView}
            folded={folded}
            onOpenContents={
              activeView === "review" && contentsRailHidden
                ? openContents
                : undefined
            }
          />
        ) : settled ? (
          <>
            <div aria-hidden="true" {...stylex.props(dividerStyles.vertical)} />
            <ReviewCornerAction />
          </>
        ) : null}
      </div>
    </header>
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
