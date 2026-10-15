import {
  fontSize,
  fontWeight,
  leading,
  radius,
  space,
} from "@canvas/scale.stylex";
import { IconButton, buttonStyles } from "@canvas/ui/button";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CommitIcon,
  SortAscendingIcon,
  SortDescendingIcon,
} from "@canvas/ui/icons";
import { listRowStyles } from "@canvas/ui/list-row";
import { menuStyles, moveMenuFocus } from "@canvas/ui/menu";
import { pillStyles } from "@canvas/ui/pill";
import { Popover } from "@canvas/ui/popover";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
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
        <PickedPill
          commit={picked}
          pill={pill}
          open={open}
          onToggle={() => setOpen(!open)}
          onClear={() => onPick(null)}
        />
      ) : (
        <button
          ref={pill}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`All ${countLabel(commits.length, "commit")}. Choose commits`}
          {...stylex.props(
            focusStyles.ring,
            buttonStyles.reset,
            pillStyles.pill,
            pillStyles.neutral,
            pillStyles.pressable,
            styles.pillLabel,
            styles.all,
          )}
          onClick={() => setOpen(!open)}
        >
          <CommitIcon xstyle={styles.icon} />
          Commits
          <span {...stylex.props(textStyles.count, styles.count)}>
            {commits.length}
          </span>
        </button>
      )}
      {picked ? (
        <>
          <StepButton
            label="Older commit"
            up
            atEnd={index <= 0}
            onClick={() => step(-1)}
          />
          <StepButton
            label="Newer commit"
            atEnd={index >= oldestFirst.length - 1}
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

/** "Commit 8d52426 ×": the menu's trigger, and the × back to all. */
function PickedPill({
  commit,
  pill,
  open,
  onToggle,
  onClear,
}: {
  commit: ReviewSidebarCommit;
  pill: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onToggle(): void;
  onClear(): void;
}): ReactElement {
  const subjectTooltip = useTooltip(commit.subject);
  const clearTooltip = useTooltip("All commits");

  return (
    <span {...stylex.props(pillStyles.pill, pillStyles.neutral, styles.picked)}>
      <button
        ref={(element) => {
          pill.current = element;

          return subjectTooltip(element);
        }}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Commit ${commit.commit.slice(0, 7)}: ${commit.subject}. Choose commits`}
        {...stylex.props(
          focusStyles.ringInset,
          buttonStyles.reset,
          styles.pillLabel,
        )}
        onClick={onToggle}
      >
        Commit
        <code {...stylex.props(styles.sha)}>{commit.commit.slice(0, 7)}</code>
      </button>
      <span {...stylex.props(styles.divider)} />
      <button
        ref={clearTooltip}
        type="button"
        aria-label="Show all commits"
        {...stylex.props(
          focusStyles.ringInset,
          buttonStyles.reset,
          styles.clear,
        )}
        onClick={onClear}
      >
        <CloseIcon xstyle={iconStyles.inline} />
      </button>
    </span>
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
          {selected ? null : <CheckIcon xstyle={iconStyles.inline} />}
        </span>
        <span {...stylex.props(styles.allTitle)}>All commits</span>
        <span {...stylex.props(styles.allCount)}>
          {countLabel(total, "commit")}
        </span>
      </button>
      <div
        role="separator"
        {...stylex.props(menuStyles.separator, styles.rule)}
      />
      <div {...stylex.props(styles.header)}>
        Specific commits
        <SortButton newestFirst={newestFirst} onFlip={onFlip} />
      </div>
      <div {...stylex.props(styles.list)}>
        {commits.map((commit, index) => (
          <div key={commit.commit}>
            {index > 0 ? (
              <span aria-hidden="true" {...stylex.props(styles.link)} />
            ) : null}
            <CommitRow
              commit={commit}
              here={commit.commit === selected}
              now={now}
              onPick={onPick}
            />
          </div>
        ))}
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

function CommitRow({
  commit,
  here,
  now,
  onPick,
}: {
  commit: ReviewSidebarCommit;
  here: boolean;
  now: number;
  onPick(commit: string): void;
}): ReactElement {
  const tooltip = useTooltip(commit.subject);

  return (
    <button
      ref={tooltip}
      type="button"
      role="menuitemradio"
      aria-checked={here}
      {...stylex.props(
        focusStyles.ringInset,
        buttonStyles.reset,
        menuStyles.item,
        styles.row,
        here && listRowStyles.current,
      )}
      onClick={() => onPick(commit.commit)}
    >
      <span {...stylex.props(styles.dot, here && styles.dotPicked)} />
      <code {...stylex.props(styles.rowSha, here && styles.rowShaPicked)}>
        {commit.commit.slice(0, 7)}
      </code>
      <span {...stylex.props(textStyles.truncate, styles.subject)}>
        {commit.subject}
      </span>
      <span {...stylex.props(styles.when)}>
        {formatRelativeTime(commit.authoredAt, now, { short: true })}
      </span>
    </button>
  );
}

function SortButton({
  newestFirst,
  onFlip,
}: {
  newestFirst: boolean;
  onFlip(): void;
}): ReactElement {
  const label = newestFirst ? "Newest first" : "Oldest first";
  const tooltip = useTooltip(label);

  return (
    <IconButton ref={tooltip} size="small" aria-label={label} onClick={onFlip}>
      {newestFirst ? (
        <SortDescendingIcon xstyle={styles.icon} />
      ) : (
        <SortAscendingIcon xstyle={styles.icon} />
      )}
    </IconButton>
  );
}

/** ∧ or ∨ through the commits. At the end it stays focusable and does
 * nothing, so a held key does not drop focus. */
function StepButton({
  label,
  up = false,
  atEnd,
  onClick,
}: {
  label: string;
  up?: boolean;
  atEnd: boolean;
  onClick(): void;
}): ReactElement {
  const tooltip = useTooltip(label);

  return (
    <button
      ref={tooltip}
      type="button"
      aria-label={label}
      aria-disabled={atEnd || undefined}
      {...stylex.props(
        focusStyles.ring,
        buttonStyles.reset,
        pillStyles.pill,
        pillStyles.neutral,
        pillStyles.pressable,
        styles.step,
      )}
      onClick={() => {
        if (!atEnd) onClick();
      }}
    >
      <ChevronDownIcon xstyle={[styles.stepIcon, up && iconStyles.flip]} />
    </button>
  );
}

// Centres the 1px link under the commit dots.
const DOT_CENTER = "12.5px";

const styles = stylex.create({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: space.s6,
    minWidth: 0,
    paddingBlock: `${space.s6} ${space.s2}`,
    paddingInline: space.s12,
  },
  // In a narrow sidebar the label gives way; the ×, ∧ and ∨ never do.
  pillLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s8,
    minWidth: 0,
    overflow: "hidden",
    height: "26px",
    paddingBlock: 0,
    paddingInline: `${space.s10} ${space.s8}`,
    borderRadius: radius.pill,
    color: tokens.ink,
    cursor: "pointer",
  },
  all: {
    paddingInline: space.s10,
    fontSize: fontSize.body,
    lineHeight: leading.px16,
  },
  picked: {
    gap: 0,
    minWidth: 0,
    height: "26px",
    overflow: "hidden",
    fontSize: fontSize.body,
    lineHeight: leading.px16,
  },
  icon: { width: "14px", height: "14px" },
  count: { color: tokens.inkFaint },
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
    backgroundColor: {
      default: tokens.transparent,
      ":hover": tokens.markerTint,
    },
    color: tokens.inkMuted,
    cursor: "pointer",
  },
  step: {
    flexShrink: 0,
    justifyContent: "center",
    width: "26px",
    height: "26px",
    padding: 0,
    color: tokens.inkMuted,
    cursor: { default: "pointer", ':is([aria-disabled="true"])': "default" },
    opacity: { default: null, ':is([aria-disabled="true"])': 0.4 },
  },
  stepIcon: { width: "10px", height: "10px" },
  // The shared menu, one list under its header; the list scrolls.
  menu: {
    gap: 0,
    width: "min(440px, calc(100vw - 16px))",
    padding: 0,
    overflowY: "hidden",
    font: `${fontSize.body}/${leading.px16} ${tokens.chromeFont}`,
  },
  allRow: {
    gap: space.s10,
    height: "44px",
    paddingInline: space.s16,
    borderRadius: 0,
    fontSize: fontSize.body,
  },
  check: { display: "flex", width: "12px" },
  allTitle: {
    flex: "1 1 0",
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
  },
  allCount: { color: tokens.inkMuted },
  rule: { marginBlock: 0 },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "40px",
    paddingInline: space.s16,
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
  },
  // A long range scrolls inside the menu.
  list: {
    maxHeight: "min(360px, 50vh)",
    overflowY: "auto",
    paddingBottom: space.s10,
    paddingInline: space.s8,
  },
  link: {
    display: "block",
    width: "1px",
    height: "8px",
    marginLeft: DOT_CENTER,
    backgroundColor: tokens.rule,
  },
  row: {
    gap: space.s10,
    height: "28px",
    minHeight: 0,
    paddingBlock: 0,
    borderRadius: radius.small,
    fontSize: fontSize.body,
  },
  dot: {
    flexShrink: 0,
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
  subject: { flex: "1 1 0", minWidth: 0, fontSize: fontSize.ui },
  when: { flexShrink: 0, color: tokens.inkFaint },
  changes: {
    display: "flex",
    alignItems: "center",
    gap: space.s6,
    fontSize: fontSize.body,
    whiteSpace: "nowrap",
  },
});
