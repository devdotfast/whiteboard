import { elevation, fontSize, fontWeight, radius } from "@canvas/scale.stylex";
import type {
  BoardIconKind,
  PullRequestState,
  ReviewBoardPlace,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type MouseEvent,
  type ReactElement,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { BoardIcon, PullRequestStateIcon } from "./board-icons";
import { useReviewSession } from "./host/review-session";
import { tokens } from "./tokens.stylex";
import { useAnchoredPopover } from "./use-anchored-popover";
import { useDismissOnOutside } from "./use-dismiss-on-outside";

type OpenEvent = Pick<
  MouseEvent,
  "metaKey" | "ctrlKey" | "shiftKey" | "button"
>;

/** One place in the list the count opens. */
interface PlaceRow {
  key: string;
  title: string;
  icon?: BoardIconKind;
  pullRequestNumber?: number;
  pullRequestState?: PullRequestState;
  here: boolean;
  open(event: OpenEvent): void;
}

/**
 * "[icon] Parent › 3 of 8 ⌄" above a child's title. The parent opens the
 * parent board; the count lists its children in order. A lone child shows
 * the parent alone. A branch stack is apart: the meta line's Stack pill.
 */
export function ReviewBreadcrumb({
  place,
  reviewId,
}: {
  place: ReviewBoardPlace;
  reviewId: string;
}): ReactElement | null {
  const session = useReviewSession();
  const [open, setOpen] = useState(false);
  const control = useRef<HTMLSpanElement>(null);
  const popoverRef = useAnchoredPopover(open, control);

  useDismissOnOutside(control, open, setOpen);

  const { parent, siblings } = place;

  const openBoard = (id: string, event: OpenEvent) => {
    setOpen(false);
    void session.surface.post({
      name: "openReview",
      args: {
        reviewUuid: id,
        active: !(
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.button === 1
        ),
      },
    });
  };

  if (!parent) return null;

  const index = siblings.findIndex((board) => board.reviewId === reviewId);

  return (
    <nav
      aria-label="Parent whiteboard"
      {...stylex.props(styles.line)}
      data-review-copy-ignore
    >
      <button
        type="button"
        title={parent.title}
        {...stylex.props(styles.parent)}
        onClick={(event) => openBoard(parent.reviewId, event)}
        onAuxClick={(event) => {
          if (event.button === 1) openBoard(parent.reviewId, event);
        }}
      >
        <BoardIcon icon={parent.icon} />
        <span {...stylex.props(styles.parentTitle)}>{parent.title}</span>
      </button>
      {siblings.length > 1 && index >= 0 ? (
        <PlaceCount
          label={parent.title}
          index={index}
          rows={siblings.map((board) => ({
            key: board.reviewId,
            title: board.title,
            icon: board.icon,
            ...(board.pullRequestNumber && {
              pullRequestNumber: board.pullRequestNumber,
            }),
            ...(board.pullRequestState && {
              pullRequestState: board.pullRequestState,
            }),
            here: board.reviewId === reviewId,
            open: (event) => openBoard(board.reviewId, event),
          }))}
          open={open}
          setOpen={setOpen}
          control={control}
          popover={popoverRef}
        />
      ) : null}
    </nav>
  );
}

/** "› 3 of 8 ⌄", which lists the places in order. */
function PlaceCount({
  label,
  index,
  rows,
  open,
  setOpen,
  control,
  popover,
}: {
  label: string;
  index: number;
  rows: readonly PlaceRow[];
  open: boolean;
  setOpen: (open: boolean) => void;
  control: RefObject<HTMLSpanElement | null>;
  popover: ReturnType<typeof useAnchoredPopover<HTMLDivElement>>;
}): ReactElement {
  return (
    <>
      <svg
        aria-hidden="true"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        {...stylex.props(styles.chevron, styles.separator)}
      >
        <path d="M4 2.5 L6.5 5 L4 7.5" />
      </svg>
      <span ref={control} {...stylex.props(styles.control)}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${index + 1} of ${rows.length} in ${label}`}
          {...stylex.props(styles.count)}
          onClick={() => setOpen(!open)}
        >
          {index + 1} of {rows.length}
          <svg
            aria-hidden="true"
            width="10"
            height="10"
            viewBox="0 0 10 10"
            {...stylex.props(styles.chevron)}
          >
            <path d={open ? "M2.5 6 L5 3.5 L7.5 6" : "M2.5 4 L5 6.5 L7.5 4"} />
          </svg>
        </button>
        {open ? (
          <PlaceList popover={popover} label={label} rows={rows} />
        ) : null}
      </span>
    </>
  );
}

function PlaceList({
  popover,
  label,
  rows,
}: {
  popover: ReturnType<typeof useAnchoredPopover<HTMLDivElement>>;
  label: string;
  rows: readonly PlaceRow[];
}): ReactElement {
  const list = useRef<HTMLDivElement>(null);

  // A long list opens scrolled to the board on screen.
  useEffect(() => {
    list.current
      ?.querySelector("[aria-current]")
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <div
      ref={popover}
      popover="manual"
      role="menu"
      aria-label={`In ${label}`}
      {...stylex.props(styles.menu)}
    >
      <div ref={list} {...stylex.props(styles.list)}>
        {rows.map((row, index) => (
          <button
            key={row.key}
            type="button"
            role="menuitem"
            aria-current={row.here || undefined}
            title={
              row.here
                ? undefined
                : "Open whiteboard (Cmd/Ctrl-click to open in the background)"
            }
            {...stylex.props(styles.row, row.here && styles.rowCurrent)}
            onClick={(event) => {
              if (!row.here) row.open(event);
            }}
            onAuxClick={(event) => {
              if (event.button === 1 && !row.here) row.open(event);
            }}
          >
            <span
              {...stylex.props(styles.number, row.here && styles.numberHere)}
            >
              {index + 1}
            </span>
            {row.icon ? <BoardIcon icon={row.icon} current={row.here} /> : null}
            <span {...stylex.props(styles.title, row.here && styles.titleHere)}>
              {row.title}
            </span>
            {row.pullRequestNumber ? (
              <PullRequestStateIcon
                number={row.pullRequestNumber}
                state={row.pullRequestState}
              />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

const styles = stylex.create({
  line: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    paddingBottom: "16px",
  },
  parent: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    maxWidth: "440px",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.inkMuted, ":hover": tokens.ink },
    cursor: "pointer",
  },
  parentTitle: {
    minWidth: 0,
    overflow: "hidden",
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: "18px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  separator: { stroke: tokens.inkFaint },
  control: { display: "inline-flex", flexShrink: 0 },
  count: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    paddingBlock: 0,
    paddingInline: "5px",
    borderWidth: 0,
    borderRadius: radius.small,
    backgroundColor: tokens.tray,
    color: tokens.ink,
    // "2 of 5" counts places: Inter, its digits steady.
    fontFamily: tokens.chromeFont,
    fontVariantNumeric: "tabular-nums",
    fontSize: fontSize.body,
    lineHeight: "18px",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  chevron: {
    flexShrink: 0,
    fill: "none",
    stroke: tokens.inkMuted,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 1.2,
  },
  menu: {
    position: "fixed",
    top: "calc(anchor(bottom) + 6px)",
    // Left-aligned with its control, kept inside a narrow window.
    left: `min(anchor(left), calc(100vw - 330px - 8px))`,
    margin: 0,
    width: "330px",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: radius.surface,
    backgroundColor: tokens.surface,
    boxShadow: elevation.popover,
    positionTryFallbacks: "flip-block",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    maxHeight: "320px",
    overflowY: "auto",
    padding: "6px",
  },
  row: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: "8px",
    height: "26px",
    paddingBlock: 0,
    paddingInline: "8px",
    borderWidth: 0,
    borderRadius: radius.small,
    backgroundColor: { default: "transparent", ":hover": tokens.markerTint },
    color: tokens.inkMuted,
    textAlign: "left",
    cursor: "pointer",
  },
  rowCurrent: { backgroundColor: tokens.markerTint, cursor: "default" },
  number: {
    flexShrink: 0,
    width: "12px",
    color: tokens.inkFaint,
    fontFamily: tokens.chromeFont,
    fontVariantNumeric: "tabular-nums",
    fontSize: fontSize.small,
    lineHeight: "14px",
  },
  numberHere: { color: tokens.accent },
  title: {
    flex: "1 1 0",
    minWidth: 0,
    overflow: "hidden",
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.body,
    lineHeight: "16px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  titleHere: { color: tokens.ink, fontWeight: fontWeight.medium },
});
