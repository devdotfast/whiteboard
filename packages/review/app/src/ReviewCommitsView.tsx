import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { IconButton } from "@canvas/ui/button";
import { EmptyState } from "@canvas/ui/empty-state";
import { textStyles } from "@canvas/ui/text";
import {
  type ReviewCommitSummary,
  type ReviewDiffFileWire,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { canvasQueryKeys } from "./canvas-query";
import { controlStyles } from "./controls-styles";
import { CopyButton } from "./copy-text";
import { DiffCount } from "./diff-count";
import { FileMark } from "./file-mark";
import { useReviewSession } from "./host/review-session";
import { CodeIcon, DisclosureChevron } from "./icons";
import { chevronMarker } from "./markers.stylex";
import { shortRef } from "./review-branch-range";
import { countLabel } from "./review-home-view";
import { tokens } from "./tokens.stylex";
import { captureUiEvent } from "./ui-telemetry";
import { useTooltip } from "./use-tooltip";

type OpenCommitDiff = (
  commit: ReviewCommitSummary,
  via: "row" | "file",
  file?: string,
) => void;

export function ReviewCommitsView({
  commits,
  range,
  onOpenDiff,
}: {
  commits: readonly ReviewCommitSummary[];
  range: import("@dev.fast/review-protocol").ReviewCanvasRange;
  onOpenDiff: OpenCommitDiff;
}) {
  if (range.sourceUnavailable) {
    return (
      <EmptyState
        variant="document"
        role="status"
        title="Commits unavailable"
        message={range.sourceUnavailable}
      />
    );
  }

  return (
    <div {...stylex.props(styles.view)}>
      <div {...stylex.props(styles.column)}>
        <header {...stylex.props(styles.range)}>
          <strong {...stylex.props(styles.rangeCount)}>
            {countLabel(commits.length, "commit")}
          </strong>
          <span
            {...stylex.props(styles.rangeRefs)}
            title={`${range.baseCommit}..${range.headCommit}`}
          >
            {shortRef(range.baseRef || range.baseCommit)} →{" "}
            {shortRef(range.headRef || range.headCommit)}
          </span>
        </header>
        <CommitGroups commits={commits} onOpenDiff={onOpenDiff} />
      </div>
    </div>
  );
}

function CommitGroups({
  commits,
  onOpenDiff,
}: {
  commits: readonly ReviewCommitSummary[];
  onOpenDiff: OpenCommitDiff;
}) {
  const groups = useMemo(() => groupCommitsByDate(commits), [commits]);

  return groups.map((group, index) => (
    <section key={group.key}>
      <div {...stylex.props(styles.date, index > 0 && styles.laterDate)}>
        <svg
          {...stylex.props(styles.dateIcon)}
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="3" />
        </svg>
        <h2 {...stylex.props(textStyles.eyebrow, styles.dateHeading)}>
          Commits on {group.label}
        </h2>
      </div>
      <div {...stylex.props(styles.timeline)}>
        {group.commits.map((commit) => (
          <CommitRow
            key={commit.commit}
            commit={commit}
            onOpenDiff={onOpenDiff}
          />
        ))}
      </div>
    </section>
  ));
}

function CommitRow({
  commit,
  onOpenDiff,
}: {
  commit: ReviewCommitSummary;
  onOpenDiff: OpenCommitDiff;
}) {
  const session = useReviewSession();
  const [expanded, setExpanded] = useState(false);
  const openTooltip = useTooltip("Open commit diff");

  // A commit's files never change, so the first expansion's read serves the
  // rest of the canvas's life.
  const files = useQuery({
    queryKey: canvasQueryKeys.commitFiles(commit.commit),
    queryFn: async () => [
      ...(await session.bridge.diffView.files({ commit: commit.commit })),
    ],
    enabled: expanded,
    staleTime: Infinity,
  });

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    captureUiEvent(session, "commit_expanded", { expanded: next });
  };

  const visibleFiles = files.data ? visibleCommitFiles(files.data) : null;

  const omittedFileCount = visibleFiles
    ? visibleFiles.testFilesOmitted + visibleFiles.overflowFilesOmitted
    : 0;

  return (
    <article {...stylex.props(styles.card, expanded && styles.cardExpanded)}>
      <div {...stylex.props(styles.header, expanded && styles.headerExpanded)}>
        <button
          type="button"
          {...stylex.props(chevronMarker, styles.toggle)}
          aria-expanded={expanded}
          onClick={toggleExpanded}
          title={commit.subject}
        >
          <DisclosureChevron expanded={expanded} xstyle={styles.chevron} />
          <strong {...stylex.props(styles.subject)}>{commit.subject}</strong>
        </button>
        <span {...stylex.props(styles.actions)}>
          <span {...stylex.props(styles.sha)}>{commit.commit.slice(0, 8)}</span>
          <CopyButton
            text={commit.commit}
            label="Copy commit SHA"
            iconStyle={controlStyles.chromeIcon}
          />
          <IconButton
            ref={openTooltip}
            className="review-commit-open"
            aria-label="Open commit diff"
            onClick={() => onOpenDiff(commit, "row")}
          >
            <CodeIcon xstyle={controlStyles.chromeIcon} />
          </IconButton>
        </span>
        <span {...stylex.props(styles.meta)}>
          {commit.author} · {formatCommitTime(commit.authoredAt)} ·{" "}
          {countLabel(commit.fileCount, "file")}{" "}
          <DiffCount
            additions={commit.additions}
            deletions={commit.deletions}
          />
        </span>
      </div>
      {expanded ? (
        <div {...stylex.props(styles.files)}>
          {files.isPending ? (
            <p {...stylex.props(styles.filesNote)}>Loading files…</p>
          ) : null}
          {files.isError ? (
            <p {...stylex.props(styles.filesNote)}>{files.error.message}</p>
          ) : null}
          {visibleFiles?.files.map((file) => (
            <button
              type="button"
              {...stylex.props(styles.file)}
              key={file.path}
              onClick={() => onOpenDiff(commit, "file", file.path)}
            >
              <FileMark status={file.status} />
              <span {...stylex.props(styles.filePath)}>{file.path}</span>
              <DiffCount
                additions={file.additions}
                deletions={file.deletions}
              />
            </button>
          ))}
          {omittedFileCount > 0 ? (
            <button
              type="button"
              {...stylex.props(styles.filesFooter)}
              onClick={() => onOpenDiff(commit, "row")}
            >
              {countLabel(omittedFileCount, "more file")}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export interface VisibleCommitFiles {
  files: ReviewDiffFileWire[];
  testFilesOmitted: number;
  overflowFilesOmitted: number;
}

export function visibleCommitFiles(
  files: readonly ReviewDiffFileWire[],
): VisibleCommitFiles {
  const visible = files.filter((file) => !isTestFile(file.path));
  visible.sort(
    (left, right) =>
      right.additions + right.deletions - (left.additions + left.deletions) ||
      left.path.localeCompare(right.path),
  );

  return {
    files: visible.slice(0, 8),
    testFilesOmitted: files.length - visible.length,
    overflowFilesOmitted: Math.max(0, visible.length - 8),
  };
}

function isTestFile(path: string): boolean {
  return (
    path.includes("/__tests__/") ||
    /(^|\/)__tests__\//u.test(path) ||
    /\.(test|spec)\.[^/]+$/u.test(path)
  );
}

export function groupCommitsByDate(commits: readonly ReviewCommitSummary[]) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const groups: Array<{
    key: string;
    label: string;
    commits: ReviewCommitSummary[];
  }> = [];

  const orderedCommits = [...commits].sort(
    (left, right) => Date.parse(right.authoredAt) - Date.parse(left.authoredAt),
  );

  for (const commit of orderedCommits) {
    const date = new Date(commit.authoredAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const previous = groups.at(-1);

    if (previous?.key === key) {
      previous.commits.push(commit);
    } else {
      groups.push({
        key,
        label: formatter.format(date).toUpperCase(),
        commits: [commit],
      });
    }
  }

  return groups;
}

function formatCommitTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const styles = stylex.create({
  view: {
    minHeight: "100%",
    padding: { default: "32px 24px", "@media (max-width: 760px)": "24px 16px" },
  },
  column: {
    width: "min(760px, 100%)",
    margin: "0 auto",
  },
  range: {
    display: "flex",
    alignItems: "baseline",
    gap: "12px",
    paddingBottom: "16px",
  },
  rangeCount: {
    color: tokens.ink,
    flexShrink: 0,
    font: `${fontWeight.semibold} ${fontSize.reading}/20px ${tokens.fontMono}`,
    whiteSpace: "nowrap",
  },
  rangeRefs: {
    minWidth: 0,
    overflow: "hidden",
    color: tokens.inkMuted,
    font: `${fontSize.small} ${tokens.fontMono}`,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  date: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 0",
  },
  laterDate: {
    paddingTop: "10px",
  },
  dateIcon: {
    width: "14px",
    height: "14px",
    flex: "0 0 14px",
    fill: "none",
    stroke: tokens.inkFaint,
    strokeWidth: "1.5",
  },
  dateHeading: {
    margin: 0,
  },
  timeline: {
    position: "relative",
    marginLeft: "6px",
    paddingLeft: "22px",
    "::before": {
      position: "absolute",
      top: "-8px",
      bottom: 0,
      left: 0,
      width: "1px",
      backgroundColor: tokens.ruleSoft,
      content: "''",
    },
  },
  card: {
    marginBottom: "6px",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.surface,
    boxShadow: "none",
  },
  cardExpanded: {
    borderColor: tokens.ruleSoft,
  },
  // Subject over who, when and how much; the commit's actions centered at
  // the right. The toggle's hit area covers the whole header, under the
  // actions, so the header draws its focus ring.
  header: {
    position: "relative",
    display: "grid",
    alignItems: "center",
    padding: "10px 12px",
    gap: "4px 12px",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    boxShadow: {
      default: null,
      [stylex.when.descendant(":focus-visible", chevronMarker)]:
        `inset 0 0 0 1px ${tokens.accent}`,
    },
  },
  headerExpanded: {
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
  },
  toggle: {
    display: "flex",
    minWidth: 0,
    alignItems: "center",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: "transparent",
    color: "inherit",
    gap: "10px",
    textAlign: "left",
    outline: { default: null, ":focus-visible": "none" },
    "::after": {
      position: "absolute",
      inset: 0,
      content: "''",
    },
  },
  subject: {
    overflow: "hidden",
    color: tokens.ink,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: "2px",
    gridColumn: 2,
    gridRow: "1 / 3",
  },
  sha: {
    marginRight: "6px",
    color: tokens.inkFaint,
    font: `${fontSize.small} ${tokens.fontMono}`,
    fontVariantNumeric: "tabular-nums",
  },
  meta: {
    font: `${fontSize.small} ${tokens.fontMono}`,
    fontVariantNumeric: "tabular-nums",
    paddingLeft: "26px",
    color: tokens.inkMuted,
  },
  files: {
    padding: "6px 0",
  },
  filesNote: {
    margin: "6px 12px",
    color: tokens.inkFaint,
    fontSize: fontSize.small,
  },
  file: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    gap: "10px",
    padding: "6px 12px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: { default: "transparent", ":hover": tokens.controlBg },
    color: tokens.ink,
    fontSize: fontSize.small,
    textAlign: "left",
  },
  filePath: {
    minWidth: 0,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  filesFooter: {
    padding: "6px 12px 4px 38px",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: "transparent",
    color: { default: tokens.inkFaint, ":hover": tokens.accent },
    fontSize: fontSize.micro,
  },
  // The whole header is the toggle's hit area, so its chevron stays quiet on
  // hover.
  chevron: {
    width: "16px",
    height: "16px",
    margin: 0,
    color: {
      default: tokens.inkFaint,
      [stylex.when.ancestor(":focus-visible:not(:hover)", chevronMarker)]:
        tokens.ink,
    },
  },
});
