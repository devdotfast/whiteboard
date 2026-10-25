import { create, props } from "@stylexjs/stylex";

import { tokens } from "./tokens.stylex";

const styles = create({
  "review-find-match": {
    "::highlight(review-find-match)": {
      backgroundColor: tokens.reviewFindMatchBackground,
    },
  },
  "review-find-match-active": {
    "::highlight(review-find-match-active)": {
      backgroundColor: tokens.reviewFindMatchActiveBackground,
    },
  },
  "ask-thread": {
    "::highlight(ask-thread)": { backgroundColor: tokens.accentWash },
  },
  "ask-thread-active": {
    "::highlight(ask-thread-active)": { backgroundColor: tokens.markerGlow },
  },
});

export function setCssHighlight(
  root: HTMLElement | null | undefined,
  name: keyof typeof styles,
  ranges: readonly Range[],
  priority = 0,
): void {
  // SAFETY: Window omits these DOM types; jsdom also omits the runtime API.
  const view = root?.ownerDocument.defaultView as
    | (Window & {
        CSS?: { highlights?: HighlightRegistry };
        Highlight?: typeof Highlight;
      })
    | null
    | undefined;

  const registry = view?.CSS?.highlights;

  if (!root || !registry || !view?.Highlight) return;

  if (ranges.length) {
    const highlight = new view.Highlight(...ranges);
    highlight.priority = priority;
    registry.set(name, highlight);
  } else registry.delete(name);

  root.classList.toggle(props(styles[name]).className!, ranges.length > 0);
}
