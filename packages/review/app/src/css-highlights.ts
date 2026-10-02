const backgrounds = {
  "review-find-match": "--review-find-match-background",
  "review-find-match-active": "--review-find-match-active-background",
  "ask-thread": "--accent-wash",
  "ask-thread-active": "--marker-glow",
} as const;

type HighlightName = keyof typeof backgrounds;

const styles = new WeakMap<Document, HTMLStyleElement>();

/**
 * Paints ranges through the CSS Custom Highlight API; no ranges clears it.
 * Each `::highlight` rule exists only while its highlight does, because any
 * such rule makes every style recalculation slower, even with nothing painted.
 */
export function setCssHighlight(
  document: Document | null | undefined,
  name: HighlightName,
  ranges: readonly Range[],
  priority = 0,
): void {
  // SAFETY: lib.dom declares the CSS Custom Highlight API only on
  // globalThis; it is read off the document's window and stays optional
  // because jsdom does not implement it.
  const view = document?.defaultView as
    | (Window & {
        CSS?: { highlights?: HighlightRegistry };
        Highlight?: typeof Highlight;
      })
    | null
    | undefined;

  const registry = view?.CSS?.highlights;

  if (!document || !registry || !view?.Highlight) return;

  if (ranges.length) {
    const highlight = new view.Highlight(...ranges);
    highlight.priority = priority;
    registry.set(name, highlight);
  } else registry.delete(name);

  const rules = Object.entries(backgrounds)
    .filter(([highlight]) => registry.has(highlight))
    .map(
      ([highlight, color]) =>
        `::highlight(${highlight}) { background: var(${color}); }`,
    )
    .join("\n");

  let style = styles.get(document);

  if (!rules) {
    style?.remove();
    styles.delete(document);

    return;
  }

  if (!style) {
    style = document.createElement("style");
    document.head.append(style);
    styles.set(document, style);
  }

  if (style.textContent !== rules) style.textContent = rules;
}
