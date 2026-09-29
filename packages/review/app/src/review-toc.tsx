import * as stylex from "@stylexjs/stylex";
import { type ReactElement, useEffect, useState } from "react";

import { ContentsIcon } from "./icons";
import type { ReviewTocEntry } from "./review-document-headings";
import {
  cssIdentifier,
  getReviewScrollRoot,
  scrollToReviewHeading,
} from "./review-heading-scroll";
import { useReviewRoots } from "./review-root-context";
import {
  activeTargetForScroll,
  scrollTailHeight,
} from "./scroll-active-tracking";
import { tokens } from "./tokens.stylex";

interface NumberedReviewTocEntry extends ReviewTocEntry {
  number: string;
}

/**
 * Narrowest shell that fits the rail beside the prose: the 720px prose
 * measure sits centered, so each gutter is (shell - 720) / 2, and the rail
 * needs left offset (24) + card (up to ~286 with padding) + breathing room
 * before the text starts — a ~320px gutter, so a 1360px shell.
 */
const TOC_RAIL_MIN_SHELL_WIDTH = 1360;

/**
 * Room to leave above the last heading once it is scrolled to the top, so
 * the tail spacer is no larger than it needs to be. Mirrors the tour feed.
 */
const TAIL_TOP_SLACK_PX = 24;

/** CSS custom property the scroll region reads for its tail padding. */
const TAIL_CSS_PROPERTY = "--review-toc-tail";

export function ReviewToc({
  entries,
}: {
  entries: readonly ReviewTocEntry[];
}): ReactElement | null {
  const roots = useReviewRoots();
  const shellRef = roots?.shellRef;
  const scrollRegionRef = roots?.scrollRegionRef;
  const articleRef = roots?.articleRef;
  const [active, setActive] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isWide, setIsWide] = useState(false);

  // A wide shell keeps the rail beside the prose for the whole document; the
  // rail sits outside the scroll region, so it stays put while the reader
  // scrolls and only the active underline moves. When the shell narrows
  // (small window or open side panel), collapse to the breadcrumb pill.
  useEffect(() => {
    const shell = shellRef?.current;

    if (!shell) return;

    const updateWidth = () => {
      setIsWide(shell.clientWidth >= TOC_RAIL_MIN_SHELL_WIDTH);
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(shell);

    return () => resizeObserver.disconnect();
  }, [shellRef]);

  useEffect(() => {
    if (isWide) setIsDrawerOpen(false);
  }, [isWide]);

  useEffect(() => {
    if (!isDrawerOpen) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) return;

      if (target instanceof Element && target.closest("#review-toc")) return;

      setIsDrawerOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
    };
  }, [isDrawerOpen]);

  useEffect(() => {
    setActive((current) =>
      entries.some((entry) => entry.id === current)
        ? current
        : (entries[0]?.id ?? null),
    );
  }, [entries]);

  useEffect(() => {
    if (entries.length < 2) {
      setActive(null);

      return;
    }

    // Entries are stable across MDX hydration and HMR remounts (same ids), so
    // this effect may never re-run after the document/scroll-root nodes are
    // replaced. Re-query on every update — and listen in capture phase at the
    // document level — so the tracking never binds to detached nodes.
    // The highlight follows the shared scroll-tracking rule (see
    // scroll-active-tracking.ts), the same one the tour feed uses, so a
    // click's instant jump lands on its entry without lighting up the ones
    // in between.
    const visibleHeadings = (article: HTMLElement) =>
      entries
        .flatMap((entry) => {
          const heading = article.querySelector<HTMLElement>(
            `#${cssIdentifier(entry.id)}`,
          );

          return heading ? [heading] : [];
        })
        .filter(isVisibleHeadingForActiveTracking);

    const updateActiveHeading = () => {
      const article = articleRef?.current;

      if (!article) return;
      const headings = visibleHeadings(article);

      const scrollRoot = getReviewScrollRoot(
        article,
        scrollRegionRef?.current ?? null,
      );

      const rootRect = scrollRoot?.getBoundingClientRect();
      const scrollerTop = rootRect?.top ?? 0;

      const halfLine = rootRect
        ? rootRect.top + rootRect.height / 2
        : window.innerHeight / 2;

      const nextActive = activeTargetForScroll(
        headings.map((heading) => ({
          id: heading.id,
          top: heading.getBoundingClientRect().top,
        })),
        scrollerTop,
        halfLine,
      );

      if (nextActive !== null) setActive(nextActive);
    };

    // The last heading can only reach the top edge if the scroll region has
    // room below it: the region reads this tail as extra bottom padding.
    const updateTail = () => {
      const article = articleRef?.current;
      const scrollRoot = scrollRegionRef?.current;

      if (!article || !scrollRoot) return;
      const lastHeading = visibleHeadings(article).at(-1);

      if (!lastHeading) return;

      const currentTail = Number.parseFloat(
        scrollRoot.style.getPropertyValue(TAIL_CSS_PROPERTY) || "0",
      );

      const lastTargetTop =
        lastHeading.getBoundingClientRect().top -
        scrollRoot.getBoundingClientRect().top +
        scrollRoot.scrollTop;

      const tail = scrollTailHeight({
        lastTargetTop,
        slack: TAIL_TOP_SLACK_PX,
        viewportHeight: scrollRoot.clientHeight,
        contentHeightSansTail: scrollRoot.scrollHeight - currentTail,
      });

      if (tail !== currentTail) {
        scrollRoot.style.setProperty(TAIL_CSS_PROPERTY, `${tail}px`);
      }
    };

    let frame: number | null = null;

    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateActiveHeading();
      });
    };

    let tailFrame: number | null = null;

    const scheduleTail = () => {
      if (tailFrame !== null) return;
      tailFrame = requestAnimationFrame(() => {
        tailFrame = null;
        updateTail();
        updateActiveHeading();
      });
    };

    document.addEventListener("scroll", scheduleUpdate, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", scheduleTail);
    updateTail();
    updateActiveHeading();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleTail);

    const scrollRoot = scrollRegionRef?.current;
    const article = articleRef?.current;

    if (resizeObserver && scrollRoot) resizeObserver.observe(scrollRoot);

    if (resizeObserver && article) resizeObserver.observe(article);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);

      if (tailFrame !== null) cancelAnimationFrame(tailFrame);
      resizeObserver?.disconnect();
      scrollRegionRef?.current?.style.removeProperty(TAIL_CSS_PROPERTY);
      document.removeEventListener("scroll", scheduleUpdate, {
        capture: true,
      });
      window.removeEventListener("resize", scheduleTail);
    };
  }, [articleRef, entries, scrollRegionRef]);

  if (entries.length < 2) return null;

  const scrollTo = (id: string) => {
    scrollToReviewHeading(
      id,
      articleRef?.current ?? null,
      scrollRegionRef?.current ?? null,
    );
    setActive(id);
    setIsDrawerOpen(false);
  };

  const numberedEntries = numberReviewTocEntries(entries);

  const showRail = isWide;
  const showList = showRail || isDrawerOpen;

  // On a narrow shell the nav is the pill: a 32px square holding only the
  // contents glyph, anchored where the pill has always sat. Opening does not
  // summon a second card; the same box grows in place, its top-left corner
  // pinned and the glyph still in it, until it is the contents card. The rail
  // on a wide shell is the same nav without the button. The key remounts the
  // nav, so a resize or zoom change swaps rail and pill without animating.
  return (
    <nav
      key={showRail ? "rail" : "pill"}
      id="review-toc"
      {...stylex.props(
        styles.toc,
        showList && styles.tocOpen,
        showRail && styles.tocRail,
      )}
      aria-label="Contents"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setIsDrawerOpen(false);
        }
      }}
    >
      <button
        type="button"
        {...stylex.props(styles.toggle, showList && styles.toggleOpen)}
        aria-label={isDrawerOpen ? "Close contents" : "Open contents"}
        aria-expanded={isDrawerOpen}
        aria-controls="review-toc-body"
        hidden={showRail || undefined}
        onClick={() => setIsDrawerOpen((open) => !open)}
      >
        <ContentsIcon xstyle={styles.toggleIcon} />
      </button>
      <div
        id="review-toc-body"
        {...stylex.props(
          styles.body,
          showList && styles.bodyOpen,
          showRail && styles.bodyRail,
        )}
      >
        <div {...stylex.props(styles.head, showRail && styles.headRail)}>
          Contents
        </div>
        <ul {...stylex.props(styles.list, showRail && styles.listRail)}>
          {numberedEntries.map((entry) => (
            <li
              key={entry.id}
              {...stylex.props(
                styles.item,
                entry.level === "h3" && styles.itemH3,
              )}
            >
              <button
                type="button"
                {...stylex.props(
                  styles.link,
                  showRail && styles.linkRail,
                  active === entry.id && styles.linkActive,
                )}
                onClick={() => scrollTo(entry.id)}
              >
                <span
                  {...stylex.props(
                    styles.number,
                    showRail && styles.numberRail,
                    active === entry.id && styles.numberActive,
                  )}
                >
                  {entry.number}
                </span>
                <span {...stylex.props(styles.text)}>{entry.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function numberReviewTocEntries(
  entries: readonly ReviewTocEntry[],
): NumberedReviewTocEntry[] {
  let sectionIndex = 0;
  let subsectionIndex = 0;

  return entries.map((entry) => {
    if (entry.level === "h2") {
      sectionIndex += 1;
      subsectionIndex = 0;

      return { ...entry, number: `${sectionIndex}` };
    }

    subsectionIndex += 1;

    return {
      ...entry,
      number: `${sectionIndex}.${subsectionIndex}`,
    };
  });
}

function isVisibleHeadingForActiveTracking(heading: HTMLElement): boolean {
  if (heading.closest("[hidden]")) return false;
  const rect = heading.getBoundingClientRect();

  return rect.width !== 0 || rect.height !== 0;
}

const narrow = "@media (max-width: 720px)";

const reducedMotion = "@media (prefers-reduced-motion: reduce)";

// Beside a review header the rail lines up with the left edge of a 1320px
// page and gives each entry a taller row and larger type.
const besideHeader = ":is(.review-app:has(.review-document-header) *)";

// On a narrow shell the nav is the pill and the card in one: a 32px square at
// the pill's anchor that grows in place, top-left corner pinned, into the
// 248px contents card. Width and height animate; the list only fades, late in
// and early out, so no frame shows stretching text. The radius holds at 8px
// so the eye tracks one shape. On a wide shell the same nav is the rail:
// always open, no button, no card chrome.
const styles = stylex.create({
  toc: {
    position: "absolute",
    // Sits 16px above the content top so it clears the page title.
    top: `calc(32px + ${tokens.reviewPageTop})`,
    left: { default: "24px", [narrow]: "8px" },
    zIndex: 32,
    display: "block",
    flex: "none",
    width: "32px",
    height: "32px",
    overflow: "hidden",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.rule,
    borderRadius: "8px",
    boxShadow: `0 6px 18px ${tokens.shadowColor}`,
    color: tokens.inkMuted,
    fontFamily: tokens.fontSerif,
    interpolateSize: "allow-keywords",
    transition: {
      default:
        "width 180ms cubic-bezier(0.2, 0.7, 0.2, 1) 80ms, height 180ms cubic-bezier(0.2, 0.7, 0.2, 1) 80ms, box-shadow 180ms ease 80ms",
      [reducedMotion]: "none",
    },
    backgroundColor: tokens.surface,
  },
  tocOpen: {
    width: { default: "248px", [narrow]: "min(248px, calc(100cqi - 16px))" },
    height: "auto",
    boxShadow: `0 1px 0 ${tokens.tocInnerShadow}, 0 18px 44px ${tokens.shadowColor}`,
    transition: {
      default:
        "width 220ms cubic-bezier(0.2, 0.7, 0.2, 1), height 220ms cubic-bezier(0.2, 0.7, 0.2, 1), box-shadow 220ms ease",
      [reducedMotion]: "none",
    },
  },
  // A wide shell renders the contents as a plain rail beside the prose,
  // without the floating-card chrome, for the whole document. It keeps the
  // card's inner layout but never grows or shrinks.
  tocRail: {
    top: `calc(48px + ${tokens.reviewPageTop} + 40px)`,
    left: {
      default: "24px",
      [besideHeader]: "max(24px, calc((100% - 1320px) / 2))",
      [narrow]: {
        default: "8px",
        [besideHeader]: "max(24px, calc((100% - 1320px) / 2))",
      },
    },
    zIndex: 31,
    width: {
      default: "248px",
      [besideHeader]: "240px",
      [narrow]: {
        default: "min(248px, calc(100cqi - 16px))",
        [besideHeader]: "240px",
      },
    },
    overflow: "visible",
    padding: { default: "20px 18px 22px 20px", [besideHeader]: "6px 0 0" },
    transition: "none",
    borderColor: tokens.transparent,
    backgroundColor: tokens.transparent,
    boxShadow: "none",
  },
  toggle: {
    position: "absolute",
    top: 0,
    left: 0,
    display: { default: "flex", ":is([hidden])": "none" },
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    borderRadius: "7px",
    backgroundColor: {
      default: tokens.transparent,
      ":hover": tokens.well,
      ":focus-visible": tokens.well,
    },
    color: {
      default: "inherit",
      ":hover": tokens.ink,
      ":focus-visible": tokens.ink,
    },
    outline: {
      default: null,
      ":focus-visible": `1px solid ${tokens.ruleSoft}`,
    },
    outlineOffset: { default: null, ":focus-visible": "-3px" },
  },
  toggleOpen: {
    color: tokens.ink,
  },
  toggleIcon: {
    flex: "0 0 auto",
  },
  body: {
    maxHeight: "min(488px, calc(100dvh - 196px))",
    overflow: "auto",
    opacity: 0,
    pointerEvents: "none",
    transition: {
      default: "opacity 80ms ease",
      [reducedMotion]: "opacity 140ms ease",
    },
  },
  bodyOpen: {
    opacity: 1,
    pointerEvents: "auto",
    transition: {
      default: "opacity 140ms ease 100ms",
      [reducedMotion]: "opacity 140ms ease",
    },
  },
  bodyRail: {
    maxHeight: "min(520px, calc(100dvh - 164px))",
    transition: "none",
  },
  // The card's first row is the pill's row: 32px tall, the label set in from
  // the glyph. The rail has no glyph, so its head sits flush.
  head: {
    height: "32px",
    paddingLeft: "32px",
    fontFamily: tokens.fontMono,
    lineHeight: "32px",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    color: tokens.inkFaint,
    fontSize: "11px",
    fontWeight: 400,
    letterSpacing: tokens.wbCaps,
  },
  headRail: {
    height: "auto",
    marginBottom: "14px",
    paddingBottom: { default: null, [besideHeader]: "10px" },
    paddingLeft: { default: 0, [besideHeader]: "14px" },
    lineHeight: "normal",
  },
  list: {
    display: "grid",
    margin: 0,
    padding: "4px 18px 20px 20px",
    listStyle: "none",
    gap: "6px",
  },
  listRail: {
    padding: 0,
    gap: { default: "6px", [besideHeader]: "4px" },
  },
  item: {
    margin: 0,
    padding: 0,
  },
  itemH3: {
    paddingLeft: "14px",
  },
  link: {
    display: "flex",
    alignItems: "baseline",
    width: "100%",
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "currentcolor",
    backgroundColor: tokens.transparent,
    fontWeight: 400,
    textAlign: "left",
    position: "relative",
    gap: "10px",
    padding: "2px 0",
    borderRadius: 0,
    color: {
      default: tokens.inkMuted,
      ":hover": tokens.ink,
      ":focus-visible": tokens.ink,
    },
    fontFamily: tokens.fontMono,
    fontSize: "12px",
    lineHeight: "18px",
    outline: { default: null, ":hover": "none", ":focus-visible": "none" },
  },
  linkRail: {
    minHeight: { default: null, [besideHeader]: "30px" },
    gap: { default: "10px", [besideHeader]: "12px" },
    paddingBlock: { default: null, [besideHeader]: 0 },
    fontSize: { default: "12px", [besideHeader]: "13px" },
  },
  linkActive: {
    color: tokens.ink,
    fontWeight: 600,
    outline: "none",
  },
  number: {
    flex: "0 0 auto",
    color: tokens.inkFaint,
    fontFamily: tokens.fontMono,
    minWidth: "22px",
    fontSize: "11px",
  },
  numberRail: {
    flex: { default: "0 0 auto", [besideHeader]: "0 0 12px" },
    minWidth: { default: "22px", [besideHeader]: "12px" },
    fontSize: { default: "11px", [besideHeader]: "12px" },
  },
  numberActive: {
    color: tokens.ink,
  },
  text: {
    minWidth: 0,
  },
});
