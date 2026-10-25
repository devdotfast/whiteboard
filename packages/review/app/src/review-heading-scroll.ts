import { type RefObject, useEffect, useState } from "react";

import { scrollTailHeight } from "./scroll-active-tracking";

/** Scroll `id` into view inside `article`, expanding the section holding it.
 * Returns false while it isn't rendered or its document is hidden. */
export function scrollToReviewHeading(
  id: string,
  article: HTMLElement | null,
  scrollRegion: HTMLElement | null,
): boolean {
  const heading = article?.querySelector<HTMLElement>(`#${cssIdentifier(id)}`);

  if (!article || !heading || article.closest("[hidden]")) return false;
  scrollToReviewElement(heading, article, scrollRegion);

  return true;
}

/** Scrolls to a rendered block. Returns false while it isn't rendered or
 * its document is hidden, as in the Diff view. */
export function scrollToReviewBlock(
  blockId: string,
  article: HTMLElement | null,
  scrollRegion: HTMLElement | null,
): boolean {
  const block = article?.querySelector<HTMLElement>(
    `[data-review-node-id="${blockId.replace(/["\\]/g, "\\$&")}"]`,
  );

  if (!article || !block || article.closest("[hidden]")) return false;
  scrollToReviewElement(block, article, scrollRegion);

  return true;
}

function scrollToReviewElement(
  heading: HTMLElement,
  article: HTMLElement,
  scrollRegion: HTMLElement | null,
): void {
  // Headings inside a collapsed section have no scroll position until
  // the section expands, so expand first and scroll on the next frame.
  // The jump is instant, like the tour feed's reveal: scroll-synced
  // highlighting reads the geometry after every scroll, and a smooth flight
  // would light up every heading passed on the way.
  const collapsedSection = heading.closest(".review-section--collapsed");
  collapsedSection?.dispatchEvent(new CustomEvent("review-section-expand"));

  const performScroll = () => {
    const scrollRoot = getReviewScrollRoot(article, scrollRegion);

    if (scrollRoot?.contains(heading)) {
      // Honor the heading's scroll-margin-top like scrollIntoView does, so
      // it lands a little below the edge instead of exactly on it.
      const scrollMargin =
        Number.parseFloat(window.getComputedStyle(heading).scrollMarginTop) ||
        0;

      scrollRoot.scrollTo({
        top:
          scrollRoot.scrollTop +
          heading.getBoundingClientRect().top -
          scrollRoot.getBoundingClientRect().top -
          scrollMargin,
        behavior: "auto",
      });
    } else {
      heading.scrollIntoView({ behavior: "auto", block: "start" });
    }
  };

  if (collapsedSection) {
    requestAnimationFrame(performScroll);
  } else {
    performScroll();
  }
}

export function getReviewScrollRoot(
  article: HTMLElement,
  scrollRegion: HTMLElement | null,
): HTMLElement | null {
  return scrollRegion ?? getNearestScrollableAncestor(article);
}

function getNearestScrollableAncestor(
  element: HTMLElement,
): HTMLElement | null {
  let current = element.parentElement;

  while (current) {
    const style = window.getComputedStyle(current);

    if (
      current.scrollHeight > current.clientHeight &&
      isScrollableOverflow(style.overflowY, style.overflow)
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function isScrollableOverflow(overflowY: string, overflow: string): boolean {
  return (
    overflowY === "auto" ||
    overflowY === "scroll" ||
    overflowY === "overlay" ||
    overflow === "auto" ||
    overflow === "scroll" ||
    overflow === "overlay"
  );
}

export function cssIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);

  return value.replace(/["\\]/g, "\\$&");
}

/** How far below the scroll region's top a heading still counts as read. */
const HEADING_IN_VIEW_SLACK_PX = 80;

/** Room left above the last heading once it is scrolled to the top. */
const TAIL_TOP_SLACK_PX = 24;

/** The property the scroll region reads as extra bottom padding. */
const TAIL_PROPERTY = "--review-toc-tail";

/**
 * The heading the reader is in: the last one whose top has scrolled to the
 * top of the region, else the first. It also gives the region the room below
 * the last heading for Contents to scroll it to the top.
 */
export function useHeadingInView(
  entries: readonly { id: string }[],
  articleRef: RefObject<HTMLElement | null>,
  scrollRegionRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): string | undefined {
  const [active, setActive] = useState<string>();

  useEffect(() => {
    const region = scrollRegionRef.current;

    if (!enabled || !region || entries.length === 0) {
      setActive(undefined);

      return;
    }

    const update = () => {
      const top = region.getBoundingClientRect().top + HEADING_IN_VIEW_SLACK_PX;
      let current = entries[0]?.id;

      for (const { id } of entries) {
        const heading = articleRef.current?.querySelector(
          `#${cssIdentifier(id)}`,
        );

        if (heading && heading.getBoundingClientRect().top <= top) current = id;
      }

      setActive(current);
    };

    const fitTail = () => {
      const last = entries.at(-1);

      const heading =
        last && articleRef.current?.querySelector(`#${cssIdentifier(last.id)}`);

      const current =
        Number.parseFloat(region.style.getPropertyValue(TAIL_PROPERTY)) || 0;

      const tail = heading
        ? scrollTailHeight({
            lastTargetTop:
              heading.getBoundingClientRect().top -
              region.getBoundingClientRect().top +
              region.scrollTop,
            slack: TAIL_TOP_SLACK_PX,
            viewportHeight: region.clientHeight,
            contentHeightSansTail: region.scrollHeight - current,
          })
        : 0;

      if (tail !== current)
        region.style.setProperty(TAIL_PROPERTY, `${tail}px`);
    };

    const resized =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(fitTail);

    // Its border box: the tail it sets changes only its content box.
    resized?.observe(region, { box: "border-box" });

    if (articleRef.current) resized?.observe(articleRef.current);

    fitTail();
    update();
    region.addEventListener("scroll", update, { passive: true });

    return () => {
      region.removeEventListener("scroll", update);
      resized?.disconnect();
      region.style.removeProperty(TAIL_PROPERTY);
    };
  }, [entries, articleRef, scrollRegionRef, enabled]);

  return active;
}
