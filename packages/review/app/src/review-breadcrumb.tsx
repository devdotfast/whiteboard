import { fontSize, leading, radius, space } from "@canvas/scale.stylex";
import { BoardIcon, PullRequestStateIcon } from "@canvas/ui/board-icons";
import { buttonStyles } from "@canvas/ui/button";
import { CrumbSeparator } from "@canvas/ui/crumbs";
import { focusStyles } from "@canvas/ui/focus";
import { iconStyles } from "@canvas/ui/icon-styles";
import { ChevronDownIcon } from "@canvas/ui/icons";
import { listRowStyles } from "@canvas/ui/list-row";
import { menuStyles, moveMenuFocus } from "@canvas/ui/menu";
import { Popover } from "@canvas/ui/popover";
import { textStyles } from "@canvas/ui/text";
import { useTooltip } from "@canvas/ui/tooltip";
import {
  type BoardIconKind,
  type PullRequestState,
  type ReviewBoardPlace,
  boardTitle,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { countLabel } from "./format";
import { useReviewSession } from "./host/review-session";
import { tokens } from "./tokens.stylex";

type OpenEvent = Pick<
  MouseEvent,
  "metaKey" | "ctrlKey" | "shiftKey" | "button"
>;

/** One place a switcher's menu lists. */
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
 * Where the board sits, above its title:
 *  - a child: "[icon] Parent › Board · 3 of 8 ⌄". The parent opens the
 *    parent board; the switcher lists its children in order. A lone child
 *    shows the parent alone.
 *  - a top-level board with children: "[icon] Title › 18 boards ⌄", the
 *    menu listing them.
 *  - a top-level board alone: "[icon] Title".
 * A branch stack is apart: the meta line's Stack pill.
 */
export function ReviewBreadcrumb({
  place,
  reviewId,
  counted = true,
  status,
}: {
  place: ReviewBoardPlace;
  reviewId: string;
  /** False drops "· 3 of 8" from the switcher, or "18 boards" from a top
   * board's menu button, where the bar has no room; the name and the
   * chevron stay. */
  counted?: boolean;
  status?: ReactNode;
}): ReactElement | null {
  const session = useReviewSession();
  const [open, setOpen] = useState(false);
  const control = useRef<HTMLSpanElement>(null);

  const { parent, siblings, board, children = [] } = place;
  const shown = parent ?? board;

  const nameTooltip = useTooltip<HTMLElement>(
    shown ? boardTitle(shown.title) : "",
  );

  if (!shown) return null;
  const index = siblings.findIndex((board) => board.reviewId === reviewId);

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

  const boardRows = (boards: ReviewBoardPlace["siblings"]): PlaceRow[] =>
    boards.map((board) => ({
      key: board.reviewId,
      title: boardTitle(board.title),
      icon: board.icon,
      ...(board.pullRequestNumber && {
        pullRequestNumber: board.pullRequestNumber,
      }),
      ...(board.pullRequestState && {
        pullRequestState: board.pullRequestState,
      }),
      here: board.reviewId === reviewId,
      open: (event) => openBoard(board.reviewId, event),
    }));

  /** A menu button over `rows`, which lists them to jump to. */
  const menu = (
    rows: readonly PlaceRow[],
    label: string,
    within: string,
    content: ReactNode,
    /** Letters of a name to keep in view. */
    keep = 0,
  ) => (
    <span
      data-page-bar-switcher
      {...stylex.props(
        styles.counter,
        // A top board's button has no name to give up: it never shrinks.
        !counted && keep > 0 && styles.counterYields,
        keep > 0 && styles.keeps(keep),
      )}
    >
      <CrumbSeparator />
      <span ref={control} {...stylex.props(styles.control)}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          {...stylex.props(focusStyles.ring, buttonStyles.reset, styles.count)}
          onClick={() => setOpen(!open)}
        >
          {content}
          <ChevronDownIcon xstyle={[styles.chevron, open && iconStyles.flip]} />
        </button>
        {open ? (
          <PlaceList
            anchor={control}
            rows={rows}
            within={within}
            onDismiss={() => setOpen(false)}
          />
        ) : null}
      </span>
    </span>
  );

  /** "Board · 2 of 5" on a switcher, the count dropped where there is no
   * room. */
  const named = (name: string, at: number, of: number) => (
    <>
      <span
        data-page-bar-truncates
        {...stylex.props(textStyles.truncate, styles.name)}
      >
        {name}
      </span>
      {counted ? (
        <span
          data-page-bar-counter
          {...stylex.props(textStyles.count, styles.position)}
        >
          <span {...stylex.props(styles.dot)}>·</span>
          {at + 1} of {of}
        </span>
      ) : null}
    </>
  );

  if (!parent) {
    const top = board!;
    const count = countLabel(children.length, "board");

    return (
      <nav
        aria-label="Whiteboard"
        {...stylex.props(styles.line)}
        data-review-copy-ignore
        data-page-bar-crumb
      >
        {/* The board on screen: named, not a link. */}
        <span ref={nameTooltip} {...stylex.props(styles.parent, styles.self)}>
          <BoardIcon icon={top.icon} />
          <span
            data-page-bar-truncates
            {...stylex.props(textStyles.truncate, styles.parentTitle)}
          >
            {boardTitle(top.title)}
          </span>
        </span>
        {children.length
          ? menu(
              boardRows(children),
              `${count} in ${boardTitle(top.title)}`,
              boardTitle(top.title),
              counted ? (
                <span
                  data-page-bar-counter
                  {...stylex.props(textStyles.count, styles.position)}
                >
                  {count}
                </span>
              ) : null,
            )
          : null}
        {status}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Parent whiteboard"
      {...stylex.props(styles.line)}
      data-review-copy-ignore
      data-page-bar-crumb
    >
      <button
        ref={nameTooltip}
        type="button"
        {...stylex.props(focusStyles.ring, buttonStyles.reset, styles.parent)}
        onClick={(event) => openBoard(parent.reviewId, event)}
        onAuxClick={(event) => {
          if (event.button === 1) openBoard(parent.reviewId, event);
        }}
      >
        <BoardIcon icon={parent.icon} />
        <span
          data-page-bar-truncates
          {...stylex.props(textStyles.truncate, styles.parentTitle)}
        >
          {boardTitle(parent.title)}
        </span>
      </button>
      {siblings.length > 1 && index >= 0
        ? menu(
            boardRows(siblings),
            `${boardTitle(siblings[index]!.title)}, ${index + 1} of ${siblings.length} in ${boardTitle(parent.title)}`,
            boardTitle(parent.title),
            named(boardTitle(siblings[index]!.title), index, siblings.length),
            boardTitle(siblings[index]!.title).length,
          )
        : null}
      {status}
    </nav>
  );
}

/** The places a switcher jumps between, in order, the one on screen
 * marked. */
function PlaceList({
  anchor,
  rows,
  within,
  onDismiss,
}: {
  anchor: RefObject<HTMLElement | null>;
  rows: readonly PlaceRow[];
  /** What they belong to. */
  within: string;
  onDismiss(): void;
}): ReactElement {
  const popover = useRef<HTMLDivElement>(null);
  // Desktop shows one board at a time, so it opens every board in front.
  const background = useReviewSession().bridge.reportSidebar === undefined;

  // A long list opens scrolled to the board on screen.
  useEffect(() => {
    popover.current
      ?.querySelector("[aria-current]")
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <Popover
      ref={popover}
      anchor={anchor}
      onDismiss={onDismiss}
      role="menu"
      tabIndex={-1}
      aria-label={`In ${within}`}
      xstyle={[menuStyles.popover, styles.menu]}
      onKeyDown={(event) => moveMenuFocus(event)}
    >
      {rows.map((row, index) => (
        <PlaceRowButton
          key={row.key}
          row={row}
          number={index + 1}
          background={background}
        />
      ))}
    </Popover>
  );
}

function PlaceRowButton({
  row,
  number,
  background,
}: {
  row: PlaceRow;
  number: number;
  background: boolean;
}): ReactElement {
  const tooltip = useTooltip(
    row.here
      ? ""
      : background
        ? "Open whiteboard (Cmd/Ctrl-click to open in the background)"
        : "Open whiteboard",
  );

  return (
    <button
      ref={tooltip}
      type="button"
      role="menuitem"
      aria-current={row.here || undefined}
      {...stylex.props(
        focusStyles.ringInset,
        buttonStyles.reset,
        menuStyles.item,
        row.here && menuStyles.itemCurrent,
        row.here && [listRowStyles.current, styles.rowCurrent],
      )}
      onClick={(event) => {
        if (!row.here) row.open(event);
      }}
      onAuxClick={(event) => {
        if (event.button === 1 && !row.here) row.open(event);
      }}
    >
      <span
        {...stylex.props(
          textStyles.count,
          styles.number,
          row.here && styles.numberHere,
        )}
      >
        {number}
      </span>
      {row.icon ? <BoardIcon icon={row.icon} current={row.here} /> : null}
      <span {...stylex.props(textStyles.truncate, styles.title)}>
        {row.title}
      </span>
      {row.pullRequestNumber ? (
        <PullRequestStateIcon
          number={row.pullRequestNumber}
          state={row.pullRequestState}
        />
      ) : null}
    </button>
  );
}

const styles = stylex.create({
  line: {
    display: "flex",
    alignItems: "center",
    gap: space.s6,
    minWidth: 0,
  },
  // Its icon and a couple of letters stay, as the page bar's fold counts.
  parent: {
    display: "flex",
    alignItems: "center",
    gap: space.s6,
    minWidth: "48px",
    maxWidth: "440px",
    padding: 0,
    borderRadius: radius.small,
    color: { default: tokens.inkMuted, ":hover": tokens.ink },
    cursor: "pointer",
  },
  // The board on screen names itself in ink and opens nothing.
  self: { color: tokens.ink, cursor: "default" },
  parentTitle: {
    minWidth: 0,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: leading.px18,
  },
  // The switcher keeps its size while its count shows; once the count
  // has gone it gives way with the parent's title.
  counter: {
    display: "inline-flex",
    flexShrink: 0,
    alignItems: "center",
    gap: space.s6,
    minWidth: 0,
  },
  counterYields: { flexShrink: 1 },
  control: { display: "inline-flex", minWidth: 0 },
  count: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s4,
    minWidth: 0,
    paddingBlock: 0,
    paddingInline: space.s4,
    borderRadius: radius.small,
    backgroundColor: tokens.tray,
    color: tokens.ink,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: leading.px18,
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  name: { minWidth: 0 },
  // A short name stays whole as the bar narrows; a long one keeps a few
  // words before its ellipsis. 40px is the switcher's chevrons and padding.
  keeps: (letters: number) => ({
    minWidth: `calc(min(${letters}ch, 6em) + 40px)`,
  }),
  // "· 2 of 5" counts places: Inter, its digits steady.
  position: {
    display: "inline-flex",
    flexShrink: 0,
    gap: space.s4,
    color: tokens.inkMuted,
  },
  dot: { color: tokens.inkFaint },
  chevron: { width: "10px", height: "10px", color: tokens.inkMuted },
  // Kept inside a narrow window; the rest is the shared menu.
  menu: { width: "min(330px, calc(100vw - 16px))" },
  rowCurrent: { cursor: "default" },
  number: {
    flexShrink: 0,
    width: "12px",
    color: tokens.inkFaint,
    fontSize: fontSize.small,
    lineHeight: leading.px14,
  },
  numberHere: { color: tokens.accent },
  title: { flex: "1 1 0", minWidth: 0 },
});
