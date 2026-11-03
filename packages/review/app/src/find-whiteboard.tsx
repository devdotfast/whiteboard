import { fontSize, fontWeight, leading, space } from "@canvas/scale.stylex";
import { tokens } from "@canvas/tokens.stylex";
import { BoardIcon } from "@canvas/ui/board-icons";
import { Dialog } from "@canvas/ui/dialog";
import { EmptyState } from "@canvas/ui/empty-state";
import { SearchIcon, StackIcon } from "@canvas/ui/icons";
import { Kbd } from "@canvas/ui/kbd";
import { listRowStyles } from "@canvas/ui/list-row";
import { MatchedText } from "@canvas/ui/matched-text";
import { textStyles } from "@canvas/ui/text";
import { fieldStyles } from "@canvas/ui/text-field";
import {
  type ReviewApiSummary,
  type ReviewFinderProps,
  boardIconKind,
  boardTitle,
} from "@dev.fast/review-protocol";
import * as stylex from "@stylexjs/stylex";
import {
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { finderBoards, finderDetails } from "./find-whiteboard-model";
import { formatRelativeTime } from "./format";

/**
 * The finder: one search over every whiteboard, as a modal in the top
 * layer so it sits over the whole window. Arrows pick a row, Enter opens
 * it; the pointer picks the row under it. Escape or a press outside closes.
 */
export function FindWhiteboard({
  boards,
  current,
  onOpen,
  onClose,
}: ReviewFinderProps): ReactElement {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const list = useRef<HTMLUListElement>(null);
  const now = useMemo(() => Date.now(), []);

  const titles = useMemo(
    () =>
      new Map(boards.map((board) => [board.reviewId, boardTitle(board.title)])),
    [boards],
  );

  const rows = useMemo(() => finderBoards(boards, query), [boards, query]);
  const picked = rows[Math.min(active, rows.length - 1)];

  // The picked row stays in view as the arrows move it.
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [picked]);

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (!rows.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const from = Math.min(active, rows.length - 1);

      setActive((from + step + rows.length) % rows.length);
    } else if (event.key === "Enter" && picked) {
      event.preventDefault();
      onOpen(picked.reviewId);
    } else if (event.key === "Escape") {
      // The workbench claims Escape before the dialog's own cancel; the
      // canvas watches it too, and the board behind should not react.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const rowId = (board: ReviewApiSummary) => `${id}-${board.reviewId}`;

  return (
    <Dialog
      aria-labelledby={`${id}-input`}
      closedby="any"
      onClose={onClose}
      xstyle={styles.dialog}
    >
      <label {...stylex.props(styles.field)}>
        <SearchIcon xstyle={styles.searchIcon} />
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-label="Find a whiteboard"
          aria-expanded
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-activedescendant={picked ? rowId(picked) : undefined}
          placeholder="Find a whiteboard"
          value={query}
          {...stylex.props(fieldStyles.bare, styles.input)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={keyDown}
        />
        <Kbd aria-hidden="true">esc</Kbd>
      </label>
      {rows.length ? (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={query.trim() ? "Matching whiteboards" : "Recent"}
          {...stylex.props(styles.list)}
        >
          {query.trim() ? null : (
            <li
              role="presentation"
              {...stylex.props(textStyles.sectionTitle, styles.heading)}
            >
              Recent
            </li>
          )}
          {rows.map((board, index) => (
            <li
              key={board.reviewId}
              id={rowId(board)}
              role="option"
              aria-selected={board === picked}
              aria-current={board.reviewId === current ? "page" : undefined}
              {...stylex.props(
                listRowStyles.row,
                styles.row,
                board === picked && listRowStyles.current,
              )}
              onPointerMove={() => {
                if (index !== active) setActive(index);
              }}
              onClick={() => onOpen(board.reviewId)}
            >
              <span {...stylex.props(styles.iconSlot)}>
                {board.children?.length ? (
                  <StackIcon xstyle={styles.stackIcon} />
                ) : (
                  <BoardIcon
                    icon={boardIconKind(board.target)}
                    current={board.reviewId === current}
                  />
                )}
              </span>
              <span {...stylex.props(styles.text)}>
                <span {...stylex.props(textStyles.truncate, styles.title)}>
                  {board.parentId && titles.has(board.parentId) ? (
                    <span {...stylex.props(styles.parent)}>
                      {titles.get(board.parentId)}
                      {" › "}
                    </span>
                  ) : null}
                  <MatchedText
                    text={boardTitle(board.title)}
                    queries={[query]}
                  />
                </span>
                <span {...stylex.props(textStyles.truncate, styles.details)}>
                  {finderDetails(board).map((detail, position) => (
                    <span key={position}>
                      {position ? " · " : ""}
                      <MatchedText text={detail} queries={[query]} />
                    </span>
                  ))}
                </span>
              </span>
              <span
                title={board.createdAt}
                {...stylex.props(textStyles.count, styles.time)}
              >
                {formatRelativeTime(board.createdAt, now, { short: true })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          xstyle={styles.empty}
          message={
            boards.some((board) => !board.trashedAt)
              ? "No whiteboards match"
              : "No whiteboards yet"
          }
        />
      )}
      <div {...stylex.props(styles.footer)}>
        <span {...stylex.props(styles.hint)}>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span {...stylex.props(styles.hint)}>
          <Kbd>↵</Kbd> to open
        </span>
      </div>
    </Dialog>
  );
}

const styles = stylex.create({
  dialog: {
    display: "flex",
    flexDirection: "column",
    width: "min(640px, calc(100% - 48px))",
    // Near the top, as Spotlight sits, not centred: the list grows down.
    marginBlock: `${space.s120} auto`,
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
  },
  field: {
    display: "flex",
    alignItems: "center",
    gap: space.s10,
    height: space.s48,
    paddingInline: space.s16,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.ruleSoft,
  },
  searchIcon: { width: space.s16, height: space.s16, color: tokens.inkFaint },
  input: { flex: 1, fontSize: fontSize.reading, lineHeight: leading.px24 },
  list: {
    display: "flex",
    flexDirection: "column",
    maxHeight: "min(420px, calc(100vh - 240px))",
    margin: 0,
    padding: space.s6,
    overflowY: "auto",
    listStyle: "none",
    overscrollBehavior: "contain",
  },
  heading: { padding: `${space.s8} ${space.s10} ${space.s4}` },
  row: {
    gap: space.s10,
    height: "auto",
    padding: `${space.s6} ${space.s10}`,
    cursor: "default",
  },
  iconSlot: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: space.s16,
    height: space.s18,
  },
  stackIcon: { width: space.s14, height: space.s14, color: tokens.inkMuted },
  text: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minWidth: 0,
    gap: space.s2,
  },
  title: {
    fontSize: fontSize.ui,
    fontWeight: fontWeight.medium,
    lineHeight: leading.px18,
  },
  parent: { color: tokens.inkMuted, fontWeight: fontWeight.regular },
  details: {
    minHeight: leading.px16,
    color: tokens.inkMuted,
    fontSize: fontSize.small,
    lineHeight: leading.px16,
  },
  time: {
    flexShrink: 0,
    alignSelf: "flex-start",
    color: tokens.inkFaint,
    fontSize: fontSize.small,
    lineHeight: leading.px18,
  },
  empty: { padding: `${space.s24} ${space.s16}`, textAlign: "center" },
  footer: {
    display: "flex",
    gap: space.s16,
    padding: `${space.s8} ${space.s16}`,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: tokens.ruleSoft,
    color: tokens.inkFaint,
    fontSize: fontSize.small,
  },
  hint: { display: "inline-flex", alignItems: "center", gap: space.s4 },
});
