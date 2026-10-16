import { tocTickMarker } from "@canvas/markers.stylex";
import { menuStyles, moveMenuFocus } from "@canvas/ui/menu";
import { surfaceStyles } from "@canvas/ui/surface";
import * as stylex from "@stylexjs/stylex";
import {
  type ReactElement,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { type ReviewTocEntry, headingDepth } from "./review-document-headings";
import {
  scrollToReviewHeading,
  useHeadingInView,
} from "./review-heading-scroll";
import { tocLayer } from "./review-toc.stylex";
import { fontSize, fontWeight, motion, radius } from "./scale.stylex";
import { tokens } from "./tokens.stylex";
import { useAnchoredPopover } from "./use-anchored-popover";

/** Ticks this far apart, until they would run past the column's cap. */
const PITCH_PX = 12;

const TIGHT_PITCH_PX = 8;

/** The tallest the column grows; past it, it keeps the current tick
 * centred. */
const COLUMN_CAP_PX = 240;

/** Hover this long before the card opens, so a tick can be clicked. */
const OPEN_DELAY_MS = 200;

/** A pointer that strays off the card this long closes it. */
const CLOSE_DELAY_MS = 250;

/**
 * The board's contents at its right edge: a tick per heading, the section
 * in view inked. Hovering the ticks, or tabbing onto them, opens the full
 * list in their place.
 */
export function ContentsRail({
  entries,
  articleRef,
  scrollRegionRef,
}: {
  entries: readonly ReviewTocEntry[];
  articleRef: RefObject<HTMLElement | null>;
  scrollRegionRef: RefObject<HTMLElement | null>;
}): ReactElement | null {
  const current = useHeadingInView(entries, articleRef, scrollRegionRef, true);
  const [open, setOpen] = useState<false | "pointer" | "keyboard">(false);
  const rail = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const card = useAnchoredPopover(!!open, rail);
  const timer = useRef<number>(undefined);

  const pitch =
    entries.length * PITCH_PX > COLUMN_CAP_PX ? TIGHT_PITCH_PX : PITCH_PX;

  const capped = entries.length * pitch > COLUMN_CAP_PX;
  const currentIndex = entries.findIndex((entry) => entry.id === current);

  const later = (next: typeof open, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // A capped column keeps the current tick at its middle, and fades the
  // ends that have more ticks past them.
  const [more, setMore] = useState({ above: false, below: false });

  useLayoutEffect(() => {
    const element = column.current;

    if (!element || !capped) return;
    element.scrollTop =
      Math.max(0, currentIndex) * pitch + pitch / 2 - element.clientHeight / 2;

    const above = element.scrollTop > 0;

    const below =
      element.scrollTop + element.clientHeight < element.scrollHeight - 1;

    setMore((shown) =>
      shown.above === above && shown.below === below ? shown : { above, below },
    );
  }, [capped, currentIndex, pitch]);

  // The card opens on the current row: in view, and focused from the
  // keyboard.
  useLayoutEffect(() => {
    const element = card.current;

    if (!open || !element) return;

    const row =
      element.querySelector<HTMLElement>('[aria-current="location"]') ??
      element.querySelector<HTMLElement>('[role="menuitem"]');

    if (!row) return;
    element.scrollTop =
      row.offsetTop - element.clientHeight / 2 + row.offsetHeight / 2;

    if (open === "keyboard") row.focus({ preventScroll: true });
  }, [open, card]);

  const jump = (id: string) => {
    const returnFocus = card.current?.contains(document.activeElement);

    window.clearTimeout(timer.current);
    setOpen(false);
    scrollToReviewHeading(id, articleRef.current, scrollRegionRef.current);

    if (returnFocus) scrollRegionRef.current?.focus({ preventScroll: true });
  };

  if (entries.length === 0) return null;

  return (
    <div
      {...stylex.props(styles.place)}
      onMouseEnter={() => {
        if (open !== "keyboard") later("pointer", open ? 0 : OPEN_DELAY_MS);
      }}
      onMouseLeave={() => {
        if (open !== "keyboard") later(false, open ? CLOSE_DELAY_MS : 0);
      }}
      onBlur={(event) => {
        if (
          open === "keyboard" &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <div
        ref={rail}
        role="button"
        aria-label="Contents"
        aria-haspopup="menu"
        aria-expanded={!!open}
        // Its rows take focus while the card is open, so Shift+Tab leaves
        // rather than opening it again.
        tabIndex={open ? -1 : 0}
        {...stylex.props(styles.rail)}
        // A click is for its tick, and hovering opens the card; only the
        // keyboard focuses the rail.
        onMouseDown={(event) => event.preventDefault()}
        onFocus={(event) => {
          if (event.target !== event.currentTarget) return;
          window.clearTimeout(timer.current);
          setOpen("keyboard");
        }}
      >
        <div
          ref={column}
          {...stylex.props(
            styles.column,
            capped && styles.capped,
            capped && more.above && styles.moreAbove,
            capped && more.below && styles.moreBelow,
            capped && more.above && more.below && styles.moreAround,
          )}
        >
          {entries.map((entry) => (
            <div
              key={entry.id}
              data-heading={entry.id}
              {...stylex.props(
                tocTickMarker,
                styles.slot,
                pitch === TIGHT_PITCH_PX && styles.slotTight,
              )}
              onClick={() => jump(entry.id)}
            >
              <div
                {...stylex.props(
                  styles.tick,
                  headingDepth(entry) > 1 && styles.tickNested,
                  entry.id === current && styles.tickCurrent,
                )}
              />
            </div>
          ))}
        </div>
      </div>
      {open && (
        <div
          ref={card}
          popover="manual"
          role="menu"
          aria-label="Contents"
          tabIndex={-1}
          {...stylex.props(
            surfaceStyles.popover,
            menuStyles.popover,
            menuStyles.end,
            styles.card,
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              scrollRegionRef.current?.focus({ preventScroll: true });

              return;
            }

            moveMenuFocus(event);
          }}
        >
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-current={entry.id === current ? "location" : undefined}
              {...stylex.props(
                styles.row,
                styles.indent(headingDepth(entry)),
                entry.id === current && styles.rowCurrent,
              )}
              onClick={() => jump(entry.id)}
            >
              <span {...stylex.props(styles.rowText)}>{entry.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = stylex.create({
  // The last row of the document shell, over the board's scroller: at the
  // board's right edge, which is short of the window's while the right
  // column is open.
  place: {
    gridRow: "-2 / -1",
    gridColumn: "1",
    justifySelf: "end",
    alignSelf: "start",
    zIndex: tocLayer.rail,
    marginTop: `calc(${tokens.reviewPageTop} + 8px)`,
    marginRight: "16px",
  },
  rail: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    width: "40px",
    padding: "6px 8px",
    outline: "none",
  },
  column: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    width: "24px",
  },
  capped: {
    height: "240px",
    overflow: "hidden",
  },
  moreAbove: {
    maskImage: "linear-gradient(to bottom, transparent, black 24px)",
  },
  moreBelow: {
    maskImage: "linear-gradient(to top, transparent, black 24px)",
  },
  moreAround: {
    maskImage:
      "linear-gradient(to bottom, transparent, black 24px, black calc(100% - 24px), transparent)",
  },
  slot: {
    display: "flex",
    flex: "none",
    alignItems: "center",
    justifyContent: "flex-end",
    width: "24px",
    height: "12px",
    cursor: "pointer",
  },
  slotTight: {
    height: "8px",
  },
  tick: {
    width: {
      default: "16px",
      [stylex.when.ancestor(":hover", tocTickMarker)]: "20px",
    },
    height: "2px",
    borderRadius: radius.hairline,
    backgroundColor: {
      default: tokens.ghost,
      [stylex.when.ancestor(":hover", tocTickMarker)]: tokens.inkMuted,
    },
    transitionProperty: "width, background-color",
    transitionDuration: motion.fast,
  },
  tickNested: {
    width: {
      default: "10px",
      [stylex.when.ancestor(":hover", tocTickMarker)]: "14px",
    },
  },
  tickCurrent: {
    width: {
      default: "20px",
      [stylex.when.ancestor(":hover", tocTickMarker)]: "24px",
    },
    backgroundColor: tokens.ink,
  },
  // Opens over the ticks, its right edge on the rail's and its top just
  // above it, growing left.
  card: {
    top: "calc(anchor(top) - 4px)",
    boxSizing: "border-box",
    width: "248px",
    gap: "1px",
    padding: "6px",
    borderColor: tokens.rule,
    backgroundColor: tokens.surface,
    fontFamily: tokens.chromeFont,
  },
  row: {
    display: "flex",
    flex: "none",
    alignItems: "center",
    height: "28px",
    paddingBlock: 0,
    paddingRight: "10px",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: radius.small,
    backgroundColor: {
      default: tokens.transparent,
      ":hover": tokens.tray,
      ":focus": tokens.markerTint,
    },
    color: {
      default: tokens.inkMuted,
      ":hover": tokens.ink,
      ":focus": tokens.ink,
    },
    fontFamily: tokens.chromeFont,
    fontSize: fontSize.ui,
    lineHeight: "18px",
    textAlign: "left",
    cursor: "pointer",
    outline: "none",
  },
  rowText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  indent: (depth: number) => ({
    paddingLeft: `${10 + 14 * (depth - 1)}px`,
  }),
  rowCurrent: {
    color: tokens.accent,
    fontWeight: fontWeight.medium,
  },
});
