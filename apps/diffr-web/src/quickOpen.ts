/**
 * ⌘/Ctrl+P: go to a changed file by name, scored as VS Code's Quick Open scores files: the name
 * first, then its folder.
 */
import type { IMatch } from "vs/base/common/filters.js";
import {
  type FuzzyScorerCache,
  type IItemAccessor,
  compareItemsByFuzzyScore,
  prepareQuery,
  scoreItemFuzzy,
} from "vs/base/common/fuzzyScorer.js";

export interface QuickOpenFile {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed" | "copied";
  /** Why diffr folds the file, if it does. */
  hidden?: string;
}

const MAX_RESULTS = 200;

const name = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const folder = (path: string) =>
  path.slice(0, Math.max(0, path.lastIndexOf("/")));

const accessor: IItemAccessor<QuickOpenFile> = {
  getItemLabel: (file) => name(file.path),
  getItemDescription: (file) => folder(file.path),
  getItemPath: (file) => file.path,
};

const statusIcon: Record<QuickOpenFile["status"], string> = {
  added: "diff-added",
  deleted: "diff-removed",
  modified: "diff-modified",
  renamed: "diff-renamed",
  copied: "diff-renamed",
};

/** Text with its matched characters in bold. */
function highlighted(text: string, matches: IMatch[] | undefined): Node {
  const fragment = document.createDocumentFragment();
  let at = 0;

  for (const { start, end } of matches ?? []) {
    fragment.append(text.slice(at, start));
    fragment.appendChild(document.createElement("mark")).textContent =
      text.slice(start, end);
    at = end;
  }

  fragment.append(text.slice(at));

  return fragment;
}

let open: HTMLElement | undefined;

/** Show the picker over `host`; `onPick` gets the chosen path. A second call closes it. */
export function quickOpen(
  host: HTMLElement,
  files: readonly QuickOpenFile[],
  onPick: (path: string) => void,
): void {
  if (open) {
    const widget = open;
    open = undefined;
    widget.remove();

    return;
  }

  const restore =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;

  const widget = host.appendChild(document.createElement("div"));
  widget.className = "app-quick-open";
  widget.setAttribute("role", "dialog");
  widget.setAttribute("aria-label", "Go to file");
  open = widget;

  const input = widget.appendChild(document.createElement("input"));
  input.placeholder = "Go to a changed file";
  input.spellcheck = false;
  input.setAttribute("aria-label", "File name");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-controls", "app-quick-open-list");
  input.setAttribute("aria-expanded", "true");

  const list = widget.appendChild(document.createElement("ul"));
  list.id = "app-quick-open-list";
  list.setAttribute("role", "listbox");

  let shown: QuickOpenFile[] = [];
  let active = 0;
  const cache: FuzzyScorerCache = {};

  const close = (focus = true) => {
    if (open !== widget) return;
    // Removing the input blurs it, which closes again.
    open = undefined;
    widget.remove();

    if (focus) restore?.focus({ preventScroll: true });
  };

  const pick = (file: QuickOpenFile | undefined) => {
    if (!file) return;
    close(false);
    onPick(file.path);
  };

  const select = (index: number) => {
    if (!shown.length) return;
    active = (index + shown.length) % shown.length;

    for (const [i, row] of [...list.children].entries()) {
      row.setAttribute("aria-selected", String(i === active));

      if (i === active) {
        row.scrollIntoView({ block: "nearest" });
        input.setAttribute("aria-activedescendant", row.id);
      }
    }
  };

  const render = () => {
    const query = prepareQuery(input.value);

    shown = query.normalized
      ? files
          .filter(
            (file) =>
              scoreItemFuzzy(file, query, true, accessor, cache).score > 0,
          )
          .sort((a, b) =>
            compareItemsByFuzzyScore(a, b, query, true, accessor, cache),
          )
          .slice(0, MAX_RESULTS)
      : files.slice(0, MAX_RESULTS);
    list.replaceChildren();

    for (const [index, file] of shown.entries()) {
      const score = query.normalized
        ? scoreItemFuzzy(file, query, true, accessor, cache)
        : undefined;

      const row = list.appendChild(document.createElement("li"));
      row.id = `app-quick-open-${index}`;
      row.setAttribute("role", "option");
      const icon = row.appendChild(document.createElement("span"));
      icon.className = `app-quick-open-icon codicon codicon-${statusIcon[file.status]} is-${file.status}`;
      const label = row.appendChild(document.createElement("span"));
      label.className = "app-quick-open-name";
      label.appendChild(highlighted(name(file.path), score?.labelMatch));
      const description = row.appendChild(document.createElement("span"));
      description.className = "app-quick-open-folder";
      description.appendChild(
        highlighted(folder(file.path), score?.descriptionMatch),
      );

      if (file.hidden) {
        const note = row.appendChild(document.createElement("span"));
        note.className = "app-quick-open-note";
        note.textContent = file.hidden;
      }

      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => pick(file));
    }

    if (!shown.length) {
      const empty = list.appendChild(document.createElement("li"));
      empty.className = "app-quick-open-empty";
      empty.textContent = "No matching files";
    }

    select(0);
  };

  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n"))
      select(active + 1);
    else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p"))
      select(active - 1);
    else if (event.key === "PageDown") select(active + 10);
    else if (event.key === "PageUp") select(active - 10);
    else if (event.key === "Enter") pick(shown[active]);
    else if (event.key === "Escape") close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  input.addEventListener("blur", () => close(false));
  render();
  input.focus();
}
