/**
 * Lenses: named parts of a comparison an agent picks out for the reader, such as "the data model"
 * or "tests". Showing one folds every file outside it, and in its files every fold that holds none
 * of its lines. They are kept per comparison, in this browser.
 */
import type { Comparison } from "./comparison.js";
import { targetPath } from "./github.js";
import { readSetting, writeSetting } from "./settings.js";
import { element } from "./ui.js";

/** Lines of one side of a file, from 1, both ends included. */
export interface LensRange {
  side: "base" | "head";
  from: number;
  to: number;
}

export interface Lens {
  id: string;
  title: string;
  description?: string;
  /** A file without ranges is shown whole. */
  files: { path: string; ranges?: LensRange[] }[];
}

const key = (comparison: Comparison) =>
  `lenses:${targetPath(comparison.target)}`;

export function lenses(comparison: Comparison): Lens[] {
  try {
    // SAFETY: setLenses wrote it.
    const value = JSON.parse(readSetting(key(comparison)) ?? "[]") as Lens[];

    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function setLenses(
  comparison: Comparison,
  value: readonly Lens[],
): void {
  writeSetting(
    key(comparison),
    value.length ? JSON.stringify(value) : undefined,
  );
}

/** A row of the comparison's lenses over the diff; empty, and it hides. */
export function renderLensBar(
  parent: HTMLElement,
  comparison: Comparison | undefined,
): void {
  parent.replaceChildren();
  const all = comparison ? lenses(comparison) : [];
  parent.hidden = !all.length;

  if (!comparison || !all.length) return;
  parent.appendChild(element("span", "app-lens-label", "Lenses"));
  const active = comparison.activeLens?.id;

  const chip = (
    title: string,
    pressed: boolean,
    onClick: () => void,
    tooltip?: string,
  ) => {
    const button = parent.appendChild(element("button", "app-lens", title));
    button.type = "button";
    button.setAttribute("aria-pressed", String(pressed));

    if (tooltip) button.title = tooltip;
    button.addEventListener("click", onClick);

    return button;
  };

  chip("All files", !active, () => comparison.showLens(undefined));

  for (const lens of all) {
    const files = lens.files.length;
    chip(
      lens.title,
      lens.id === active,
      () => comparison.showLens(lens.id === active ? undefined : lens),
      [lens.description, `${files} file${files === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const remove = parent.appendChild(
    element("button", "app-lens-clear codicon codicon-clear-all"),
  );

  remove.type = "button";
  remove.title = "Remove this comparison's lenses";
  remove.setAttribute("aria-label", remove.title);
  remove.addEventListener("click", () => {
    setLenses(comparison, []);
    comparison.showLens(undefined);
  });
}
