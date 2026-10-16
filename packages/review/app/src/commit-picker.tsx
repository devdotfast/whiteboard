import { fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import { buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { CheckIcon, CloseIcon } from "@canvas/ui/icons";
import { menuStyles, moveMenuFocus } from "@canvas/ui/menu";
import { Popover } from "@canvas/ui/popover";
import type { ReviewSidebarCommit } from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { DiffCount } from "./diff-count";
import { countLabel, formatRelativeTime } from "./format";
import { tokens } from "./tokens.stylex";

/**
 * Which of the board's commits the Diff shows: all of them, or one. A pill,
 * "Commits 4", opens the menu; with one picked it reads "Commit 8d52426 ×",
 * with ∧ to the older commit and ∨ to the newer. `commits` come newest
 * first in ancestry order, as git lists them; the menu lists them oldest
 * first unless flipped.
 */
export function CommitPicker({
  commits,
  selected,
  onPick,
  now = Date.now(),
}: {
  commits: readonly ReviewSidebarCommit[];
  selected?: string;
  onPick(commit: string | null): void;
  now?: number;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [newestFirst, setNewestFirst] = useState(false);
  const control = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);

  // Oldest first: ancestry order, never author dates, which a rebase skews.
  const oldestFirst = [...commits].reverse();
  const index = oldestFirst.findIndex(({ commit }) => commit === selected);
  const picked = index >= 0 ? oldestFirst[index] : undefined;
  const listed = newestFirst ? commits : oldestFirst;

  if (commits.length === 0) return null;

  const pick = (commit: string | null) => {
    setOpen(false);
    onPick(commit);
    pill.current?.focus();
  };

  const step = (by: -1 | 1) => {
    const next = oldestFirst[index + by];

    if (next) onPick(next.commit);
  };

  return (
    <div ref={control} {...stylex.props(styles.bar)}>
      {picked ? (
        <span {...stylex.props(styles.pill, styles.picked)}>
          <button
            ref={pill}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Commit ${picked.commit.slice(0, 7)}: ${picked.subject}. Choose commits`}
            title={picked.subject}
            {...stylex.props(styles.pillLabel)}
            onClick={() => setOpen(!open)}
          >
            Commit
            <code {...stylex.props(styles.sha)}>
              {picked.commit.slice(0, 7)}
            </code>
          </button>
          <span {...stylex.props(styles.divider)} />
          <button
            type="button"
            aria-label="Show all commits"
            title="All commits"
            {...stylex.props(styles.clear)}
            onClick={() => onPick(null)}
          >
            <CloseIcon xstyle={styles.clearIcon} />
          </button>
        </span>
      ) : (
        <button
          ref={pill}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`All ${countLabel(commits.length, "commit")}. Choose commits`}
          {...stylex.props(styles.pill, styles.pillLabel, styles.all)}
          onClick={() => setOpen(!open)}
        >
          <CommitIcon />
          Commits
          <span {...stylex.props(styles.count)}>{commits.length}</span>
        </button>
      )}
      {picked ? (
        <>
          <StepButton
            label="Older commit"
            path="M2.5 7.75 6 4.25l3.5 3.5"
            disabled={index <= 0}
            onClick={() => step(-1)}
          />
          <StepButton
            label="Newer commit"
            path="M2.5 4.25 6 7.75l3.5-3.5"
            disabled={index >= oldestFirst.length - 1}
            onClick={() => step(1)}
          />
        </>
      ) : null}
      {open ? (
        <CommitMenu
          anchor={control}
          commits={listed}
          total={commits.length}
          selected={picked?.commit}
          newestFirst={newestFirst}
          now={now}
          onFlip={() => setNewestFirst(!newestFirst)}
          onPick={pick}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function CommitMenu({
  anchor,
  commits,
  total,
  selected,
  newestFirst,
  now,
  onFlip,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  commits: readonly ReviewSidebarCommit[];
  total: number;
  selected?: string;
  newestFirst: boolean;
  now: number;
  onFlip(): void;
  onPick(commit: string | null): void;
  onClose(): void;
}): ReactElement {
  const popover = useRef<HTMLDivElement>(null);

  // The menu opens on what is picked, so arrows start from there.
  useEffect(() => {
    const menu = popover.current;

    const current =
      menu?.querySelector<HTMLElement>(
        "[role=menuitemradio][aria-checked=true]",
      ) ?? menu?.querySelector<HTMLElement>("[role=menuitemradio]");

    current?.focus();
    current?.scrollIntoView?.({ block: "nearest" });
  }, []);

  return (
    <Popover
      ref={popover}
      anchor={anchor}
      onDismiss={onClose}
      role="menu"
      tabIndex={-1}
      aria-label="Commits"
      xstyle={[menuStyles.popover, styles.menu]}
      onKeyDown={(event) => moveMenuFocus(event, "[role=menuitemradio]")}
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={!selected}
        {...stylex.props(
          focusStyles.ringInset,
          buttonStyles.reset,
          menuStyles.item,
          styles.allRow,
        )}
        onClick={() => onPick(null)}
      >
        <span {...stylex.props(styles.check)}>
          {selected ? null : <CheckIcon xstyle={styles.checkIcon} />}
        </span>
        <span {...stylex.props(styles.allTitle)}>All commits</span>
        <span {...stylex.props(styles.allCount)}>
          {countLabel(total, "commit")}
        </span>
      </button>
      <div {...stylex.props(styles.rule)} />
      <div {...stylex.props(styles.header)}>
        Specific commits
        <button
          type="button"
          aria-label={newestFirst ? "Newest first" : "Oldest first"}
          title={newestFirst ? "Newest first" : "Oldest first"}
          aria-pressed={newestFirst}
          {...stylex.props(styles.sort)}
          onClick={onFlip}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
            <path
              d={
                newestFirst
                  ? "M4 3v10M1.5 10.5 4 13l2.5-2.5M8.5 4.5h6M8.5 8h4.5M8.5 11.5h3"
                  : "M4 13V3M1.5 5.5 4 3l2.5 2.5M8.5 4.5h6M8.5 8h4.5M8.5 11.5h3"
              }
            />
          </svg>
        </button>
      </div>
      <div {...stylex.props(styles.list)}>
        {commits.map((commit, index) => {
          const here = commit.commit === selected;

          return (
            <div key={commit.commit}>
              {index > 0 ? (
                <span aria-hidden="true" {...stylex.props(styles.link)} />
              ) : null}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={here}
                title={commit.subject}
                {...stylex.props(
                  focusStyles.ringInset,
                  buttonStyles.reset,
                  menuStyles.item,
                  styles.row,
                  here && styles.rowPicked,
                )}
                onClick={() => onPick(commit.commit)}
              >
                <span {...stylex.props(styles.dot, here && styles.dotPicked)} />
                <code
                  {...stylex.props(styles.rowSha, here && styles.rowShaPicked)}
                >
                  {commit.commit.slice(0, 7)}
                </code>
                <span {...stylex.props(styles.subject)}>{commit.subject}</span>
                <span {...stylex.props(styles.when)}>
                  {formatRelativeTime(commit.authoredAt, now, { short: true })}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </Popover>
  );
}

/** A picked commit's own changes, where the board's remaining count goes. */
export function CommitChanges({
  commit,
}: {
  commit: ReviewSidebarCommit;
}): ReactElement {
  return (
    <span {...stylex.props(styles.changes)}>
      This commit
      <DiffCount additions={commit.additions} deletions={commit.deletions} />
    </span>
  );
}

function StepButton({
  label,
  path,
  disabled,
  onClick,
}: {
  label: string;
  path: string;
  disabled: boolean;
  onClick(): void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      {...stylex.props(styles.step)}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        width="10"
        height="10"
        viewBox="0 0 12 12"
        {...stylex.props(styles.glyph)}
      >
        <path d={path} />
      </svg>
    </button>
  );
}

function CommitIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      {...stylex.props(styles.icon)}
    >
      <circle cx="8" cy="8" r="2.3" />
      <path d="M1.5 8h4.2M10.3 8h4.2" />
    </svg>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const styles = stylex.create({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    paddingBlock: "6px 2px",
    paddingInline: "12px",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    height: "26px",
    borderRadius: radius.pill,
    font: `${fontSize.body}/16px ${tokens.chromeFont}`,
    color: tokens.ink,
  },
  // In a narrow sidebar the label gives way; the ×, ∧ and ∨ never do.
  pillLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    height: "26px",
    paddingBlock: 0,
    paddingInline: "10px 8px",
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: "transparent",
    color: tokens.ink,
    font: "inherit",
    cursor: "pointer",
  },
  all: {
    backgroundColor: { default: tokens.tray, ":hover": tokens.markerTint },
    boxShadow: `inset 0 0 0 1px ${tokens.rule}`,
    paddingInline: "10px",
  },
  picked: {
    overflow: "hidden",
    backgroundColor: tokens.tray,
    boxShadow: `inset 0 0 0 1px ${tokens.rule}`,
  },
  glyph: { ...stroke, flexShrink: 0, strokeWidth: 1.5 },
  clearIcon: { width: "12px", height: "12px" },
  icon: { ...stroke, flexShrink: 0, strokeWidth: 1.3 },
  count: {
    color: tokens.inkFaint,
    fontVariantNumeric: "tabular-nums",
  },
  sha: {
    color: tokens.inkMuted,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  divider: {
    alignSelf: "stretch",
    flexShrink: 0,
    width: "1px",
    backgroundColor: tokens.rule,
  },
  clear: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    padding: 0,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": tokens.markerTint },
    color: tokens.inkMuted,
    cursor: "pointer",
  },
  step: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: { default: tokens.tray, ":hover": tokens.markerTint },
    boxShadow: `inset 0 0 0 1px ${tokens.rule}`,
    color: tokens.inkMuted,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.4 },
  },
  // The shared menu, one list under its header; the list scrolls.
  menu: {
    gap: 0,
    width: "min(440px, calc(100vw - 16px))",
    padding: 0,
    overflowY: "hidden",
    font: `${fontSize.body}/16px ${tokens.chromeFont}`,
  },
  allRow: {
    gap: "10px",
    height: "44px",
    paddingInline: "16px",
    borderRadius: 0,
    fontSize: fontSize.body,
  },
  check: { display: "flex", width: "12px" },
  checkIcon: { width: "12px", height: "12px" },
  allTitle: {
    flex: "1 1 0",
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
  },
  allCount: { color: tokens.inkMuted },
  rule: { height: "1px", backgroundColor: tokens.ruleSoft },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "40px",
    paddingInline: "16px",
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
  },
  sort: {
    ...stroke,
    display: "flex",
    padding: "3px",
    borderWidth: 0,
    borderRadius: radius.small,
    backgroundColor: { default: "transparent", ":hover": tokens.markerTint },
    color: tokens.inkMuted,
    strokeWidth: 1.3,
    cursor: "pointer",
  },
  // A long range scrolls inside the menu.
  list: {
    maxHeight: "min(360px, 50vh)",
    overflowY: "auto",
    paddingBottom: "10px",
    paddingInline: "8px",
  },
  link: {
    display: "block",
    width: "1px",
    height: "8px",
    marginLeft: "12.5px",
    backgroundColor: tokens.rule,
  },
  row: {
    gap: "10px",
    height: "28px",
    minHeight: 0,
    paddingBlock: 0,
    borderRadius: radius.small,
    fontSize: fontSize.body,
  },
  rowPicked: { backgroundColor: tokens.markerTint },
  dot: {
    flexShrink: 0,
    boxSizing: "border-box",
    width: "10px",
    height: "10px",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: tokens.inkFaint,
    borderRadius: radius.pill,
  },
  dotPicked: { borderColor: tokens.accent, backgroundColor: tokens.accent },
  rowSha: {
    flexShrink: 0,
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    fontSize: fontSize.small,
  },
  rowShaPicked: { color: tokens.inkMuted },
  subject: {
    flex: "1 1 0",
    minWidth: 0,
    overflow: "hidden",
    fontSize: fontSize.ui,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  when: { flexShrink: 0, color: tokens.inkFaint },
  changes: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: fontSize.body,
    whiteSpace: "nowrap",
  },
});
