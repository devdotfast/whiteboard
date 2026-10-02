const backgrounds = {
  "review-find-match": "--review-find-match-background",
  "review-find-match-active": "--review-find-match-active-background",
  "ask-thread": "--accent-wash",
  "ask-thread-active": "--marker-glow",
} as const;

type HighlightName = keyof typeof backgrounds;

const styles = new WeakMap<Document, Map<HighlightName, HTMLStyleElement>>();

export function setHighlightStyle(
  document: Document | undefined,
  name: HighlightName,
  active: boolean,
): void {
  if (!document) return;
  let entries = styles.get(document);
  const existing = entries?.get(name);

  if (!active) {
    existing?.remove();
    entries?.delete(name);

    return;
  }

  if (existing) return;

  if (!entries) styles.set(document, (entries = new Map()));
  const style = document.createElement("style");
  style.textContent = `::highlight(${name}) { background: var(${backgrounds[name]}); }`;
  document.head.append(style);
  entries.set(name, style);
}
