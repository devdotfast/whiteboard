import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/**
 * How far the page bar has folded to fit its width, one step each:
 * 1. the switcher's "· N of M" (or a top board's "N boards") hides before
 *    any title or name is shortened; then the titles truncate, in CSS;
 * 2. Discord and the bug report move into "⋯";
 * 3. Share moves there too.
 */
export type PageBarFold = 0 | 1 | 2 | 3;

/** The parent's icon and a couple of letters before its ellipsis. */
const CRUMB_MIN = 48;

/** The switcher's chevrons and the start of its name, as it keeps them. */
const SWITCHER_MIN = 120;

/**
 * Folds the page bar in `header` as its width needs. Marked inside it:
 * `data-page-bar-crumb` (the breadcrumb), `data-page-bar-switcher` (its
 * switcher), `data-page-bar-truncates` (a title or name that ellipsizes),
 * `data-page-bar-counter` (the switcher's count) and
 * `data-page-bar-fold="chat" | "share"` (the icons that move). The counter
 * folds before the name has to give way.
 */
export function usePageBarFold(
  header: RefObject<HTMLElement | null>,
  enabled: boolean,
): PageBarFold {
  const [fold, setFold] = useState<PageBarFold>(0);
  // Widths last seen, kept for while the item is folded away.
  const seen = useRef({ counter: 0, full: 0, chat: 0, share: 0 });

  useLayoutEffect(() => {
    const bar = header.current;
    const actions = bar?.lastElementChild;

    if (!enabled || !bar || !(actions instanceof HTMLElement)) return;

    const measure = () => {
      // A bar that isn't laid out, as in a hidden tab, has no width to fit.
      if (!bar.clientWidth) return;

      const gap = parseFloat(getComputedStyle(actions).columnGap) || 0;
      const shown = { chat: 0, share: 0 };

      for (const item of actions.querySelectorAll<HTMLElement>(
        "[data-page-bar-fold]",
      )) {
        const name = item.dataset.pageBarFold;

        if (name === "chat" || name === "share")
          shown[name] += item.getBoundingClientRect().width + gap;
      }

      if (shown.chat) seen.current.chat = shown.chat;

      if (shown.share) seen.current.share = shown.share;

      const counter = bar.querySelector<HTMLElement>("[data-page-bar-counter]");
      const crumb = bar.querySelector<HTMLElement>("[data-page-bar-crumb]");

      const shownCounter = counter
        ? counter.getBoundingClientRect().width +
          (parseFloat(getComputedStyle(counter.parentElement!).columnGap) || 0)
        : 0;

      if (shownCounter) seen.current.counter = shownCounter;

      const switcher = bar.querySelector<HTMLElement>(
        "[data-page-bar-switcher]",
      );

      // The breadcrumb with every title and name whole, without the count.
      if (crumb) {
        let hidden = 0;

        for (const item of crumb.querySelectorAll<HTMLElement>(
          "[data-page-bar-truncates]",
        ))
          hidden += item.scrollWidth - item.clientWidth;

        seen.current.full =
          crumb.getBoundingClientRect().width + hidden - shownCounter;
      }

      const style = getComputedStyle(bar);

      const room =
        bar.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0) -
        (parseFloat(style.columnGap) || 0) -
        (actions.getBoundingClientRect().width - shown.chat - shown.share);

      setFold(
        pageBarFold({
          room,
          full: crumb ? seen.current.full : 0,
          crumb: crumb ? CRUMB_MIN + (switcher ? SWITCHER_MIN : 0) : 0,
          counter: counter || switcher ? seen.current.counter : 0,
          chat: seen.current.chat,
          share: seen.current.share,
        }),
      );
    };

    const observer = new ResizeObserver(measure);

    observer.observe(bar);
    observer.observe(actions);

    // The breadcrumb and its counter arrive after the first measure, once
    // the board's place has loaded: measure again when they do, and as they
    // change size.
    const watchCrumb = () => {
      for (const item of bar.querySelectorAll(
        "[data-page-bar-crumb], [data-page-bar-switcher], [data-page-bar-counter], [data-page-bar-truncates]",
      ))
        observer.observe(item);
      measure();
    };

    const arrivals = new MutationObserver(watchCrumb);

    arrivals.observe(bar, { childList: true, subtree: true });
    watchCrumb();

    return () => {
      observer.disconnect();
      arrivals.disconnect();
    };
  }, [header, enabled]);

  return enabled ? fold : 0;
}

/** The least folding that fits `room`, the bar's width less its fixed icons. */
export function pageBarFold({
  room,
  full,
  crumb,
  counter,
  chat,
  share,
}: {
  room: number;
  /** The breadcrumb whole, without its count. */
  full: number;
  /** The breadcrumb at its narrowest. */
  crumb: number;
  counter: number;
  chat: number;
  share: number;
}): PageBarFold {
  if (room >= Math.max(full, crumb) + counter + chat + share) return 0;

  if (room >= crumb + chat + share) return 1;

  if (room >= crumb + share) return 2;

  return 3;
}
