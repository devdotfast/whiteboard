import { Disposable } from "vs/base/common/lifecycle.js";

import type { Comparison } from "./comparison.js";
import { mobileViewport } from "./nativeDiffScroll.js";
import { actionButton, element } from "./ui.js";

/** A native, searchable bottom sheet; navigating still goes through the existing diff view. */
export class MobileFiles extends Disposable {
  readonly element = element("div", "app-mobile-files-host");
  private readonly sheet = element("dialog", "app-mobile-files");
  private readonly list = element("div", "app-mobile-file-list");
  private readonly search = element("input", "app-mobile-file-search");
  private paths = "";
  private selectedPath = "";
  private status = "";
  private readonly empty = element(
    "p",
    "app-mobile-files-empty",
    "No matching files",
  );
  private readonly collapsed = new Set<string>();
  private readonly fileRows: { path: string; button: HTMLButtonElement }[] = [];
  private readonly folders: { path: string; node: HTMLDetailsElement }[] = [];

  constructor(private readonly comparison: () => Comparison | undefined) {
    super();
    const heading = element("div", "app-mobile-files-heading");
    const title = element("h2", undefined, "Changed files");
    title.id = "mobile-files-title";
    this.sheet.setAttribute("aria-labelledby", title.id);
    const close = actionButton("", () => this.sheet.close());
    close.append(element("span", "codicon codicon-close"));
    close.classList.add("app-mobile-files-close");
    close.setAttribute("aria-label", "Close file tree");
    close.autofocus = true;

    const searchToggle = actionButton("", () => {
      this.search.hidden = !this.search.hidden;
      searchToggle.setAttribute("aria-expanded", String(!this.search.hidden));

      if (!this.search.hidden) this.search.focus();
      else {
        this.search.value = "";
        this.filter();
      }
    });

    searchToggle.className = "app-mobile-tree-tool";
    searchToggle.setAttribute("aria-label", "Show file search");
    searchToggle.setAttribute("aria-expanded", "false");
    searchToggle.append(element("span", "codicon codicon-search"));
    this.search.hidden = true;
    const filterMenu = element("div", "app-mobile-filter-menu");
    filterMenu.hidden = true;
    filterMenu.setAttribute("role", "group");
    filterMenu.setAttribute("aria-label", "Filter by change type");

    const filterToggle = actionButton("", () => {
      filterMenu.hidden = !filterMenu.hidden;
      filterToggle.setAttribute("aria-expanded", String(!filterMenu.hidden));
    });

    filterToggle.className = "app-mobile-tree-tool";
    filterToggle.setAttribute("aria-label", "Filter by change type");
    filterToggle.setAttribute("aria-expanded", "false");
    filterToggle.append(element("span", "codicon codicon-filter"));
    const filterWrapper = element("div", "app-mobile-filter-wrapper");
    filterWrapper.append(filterToggle, filterMenu);
    const tools = element("div", "app-mobile-files-tools");
    tools.append(searchToggle, filterWrapper, close);
    heading.append(title, tools);
    this.sheet.addEventListener("click", (event) => {
      if (
        event.target instanceof Node &&
        !filterWrapper.contains(event.target)
      ) {
        filterMenu.hidden = true;
        filterToggle.setAttribute("aria-expanded", "false");
      }
    });
    this.sheet.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !filterMenu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        filterMenu.hidden = true;
        filterToggle.setAttribute("aria-expanded", "false");
        filterToggle.focus();
      }
    });
    this.search.type = "search";
    this.search.placeholder = "Find a file…";
    this.search.setAttribute("aria-label", "Find a file");
    this.search.addEventListener("input", () => this.filter());
    const folds = element("div", "app-mobile-fold-actions");
    folds.append(
      actionButton("Fold all", () => {
        this.comparison()?.foldAll(true);
        this.sheet.close();
      }),
      actionButton("Expand all", () => {
        this.comparison()?.foldAll(false);
        this.sheet.close();
      }),
    );

    for (const [value, label] of [
      ["", "All changes"],
      ["modified", "Modified"],
      ["added", "Added"],
      ["deleted", "Deleted"],
      ["renamed", "Renamed"],
    ]) {
      const option = actionButton(label, () => {
        this.status = value;

        for (const button of filterMenu.querySelectorAll("button"))
          button.setAttribute("aria-pressed", String(button === option));
        filterToggle.classList.toggle("is-active", !!value);
        filterMenu.hidden = true;
        filterToggle.setAttribute("aria-expanded", "false");
        filterToggle.focus();
        this.filter();
      });

      option.setAttribute("aria-pressed", String(!value));
      filterMenu.append(option);
    }

    this.empty.hidden = true;
    this.sheet.append(heading, this.search, this.list, this.empty, folds);
    this.sheet.addEventListener("click", (event) => {
      const bounds = this.sheet.getBoundingClientRect();

      if (
        event.target === this.sheet &&
        (event.clientY < bounds.top ||
          event.clientX < bounds.left ||
          event.clientX > bounds.right)
      )
        this.sheet.close();
    });
    this.sheet.addEventListener("close", () => {
      const trigger =
        document.querySelector<HTMLButtonElement>(".app-header-files");

      trigger?.setAttribute("aria-expanded", "false");
      trigger?.focus({ preventScroll: true });
    });

    const resize = () => {
      if (!mobileViewport.matches) this.sheet.close();
    };

    mobileViewport.addEventListener("change", resize);
    this._register({
      dispose: () => mobileViewport.removeEventListener("change", resize),
    });
    this.element.append(this.sheet);
  }

  toggle(): void {
    if (this.sheet.open) this.sheet.close();
    else {
      document
        .querySelector(".app-header-files")
        ?.setAttribute("aria-expanded", "true");
      this.sheet.showModal();
    }
  }

  update(): void {
    const comparison = this.comparison();
    this.element.hidden = !comparison;
    const files = comparison?.fileList ?? [];
    const paths = files.map((file) => file.path).join("\0");

    if (paths === this.paths) {
      this.refreshRows(files);

      return;
    }

    this.paths = paths;
    this.search.value = "";
    this.list.replaceChildren();

    this.fileRows.length = 0;
    this.folders.length = 0;

    const root: FileFolder = {
      path: "",
      name: "",
      folders: new Map(),
      files: [],
    };

    for (const file of files) {
      const parts = file.path.split("/");
      parts.pop();
      let parent = root;

      for (const name of parts) {
        let folder = parent.folders.get(name);

        if (!folder) {
          folder = {
            name,
            path: parent.path ? `${parent.path}/${name}` : name,
            folders: new Map(),
            files: [],
          };
          parent.folders.set(name, folder);
        }

        parent = folder;
      }

      parent.files.push(file);
    }

    this.renderFolder(root, this.list);
    this.refreshRows(files);
  }

  private renderFolder(folder: FileFolder, parent: HTMLElement): void {
    for (let child of [...folder.folders.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      let label = child.name;

      // Compact single-child directory chains, as the desktop tree does.
      while (!child.files.length && child.folders.size === 1) {
        child = child.folders.values().next().value!;
        label += `/${child.name}`;
      }

      const path = child.path;
      const node = element("details", "app-mobile-folder");
      node.open = !this.collapsed.has(path);
      const summary = element("summary", "app-mobile-folder-label", label);
      summary.title = path;
      const group = element("div", "app-mobile-folder-children");
      node.append(summary, group);
      parent.append(node);
      this.folders.push({ path, node });
      node.addEventListener("toggle", () => {
        if (this.search.value.trim() || this.status) return;

        if (node.open) this.collapsed.delete(path);
        else this.collapsed.add(path);
      });
      this.renderFolder(child, group);
    }

    for (const file of folder.files.sort((a, b) =>
      a.path.localeCompare(b.path),
    )) {
      const button = actionButton(file.path.split("/").at(-1)!, () => {
        this.selectedPath = file.path;
        this.sheet.close();
        this.comparison()?.openFile(file.path);
        this.refreshRows(this.comparison()?.fileList ?? []);
      });

      button.className = "app-mobile-file-row review-changed-files-row";
      const name = file.path.split("/").at(-1)!;
      const dot = name.lastIndexOf(".");
      const label = element("span", "review-changed-files-label");
      label.append(
        element(
          "span",
          "app-mobile-file-stem",
          dot > 0 ? name.slice(0, dot) : name,
        ),
      );

      if (dot > 0)
        label.append(
          element("span", "app-mobile-file-extension", name.slice(dot)),
        );
      button.replaceChildren(
        element(
          "span",
          `review-changed-files-icon review-changed-files-icon-${file.status === "copied" ? "renamed" : file.status}`,
        ),
        label,
        element("span", "review-tree-counts"),
      );
      button.title = `${file.status}: ${file.path}`;
      button.setAttribute("aria-label", file.path);
      parent.append(button);
      this.fileRows.push({ path: file.path, button });
    }
  }

  private refreshRows(files: Comparison["fileList"]): void {
    const byPath = new Map(files.map((file) => [file.path, file]));

    const compact = new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    });

    for (const { path, button } of this.fileRows) {
      const file = byPath.get(path);

      if (!file) continue;
      button.dataset.status =
        file.status === "copied" ? "renamed" : file.status;
      button.setAttribute("aria-current", String(path === this.selectedPath));
      const description = `${file.status}${file.previousPath ? ` from ${file.previousPath}` : ""}, ${file.binary ? "binary file" : `${file.additions} lines added, ${file.deletions} lines deleted`}`;
      button.setAttribute("aria-description", description);
      button.title = `${path} — ${description}`;
      const counts = button.querySelector(".review-tree-counts")!;

      if (file.binary) counts.textContent = "Binary";
      else
        counts.replaceChildren(
          element(
            "span",
            `review-tree-added${file.additions ? "" : " is-zero"}`,
            `+${compact.format(file.additions).toLowerCase()}`,
          ),
          element(
            "span",
            `review-tree-removed${file.deletions ? "" : " is-zero"}`,
            `−${compact.format(file.deletions).toLowerCase()}`,
          ),
        );
    }

    this.filter();
  }

  private filter(): void {
    const query = this.search.value.trim().toLowerCase();

    for (const { path, button } of this.fileRows)
      button.hidden =
        !path.toLowerCase().includes(query) ||
        (!!this.status && button.dataset.status !== this.status);

    this.empty.hidden = this.fileRows.some((file) => !file.button.hidden);

    for (const { path, node } of this.folders) {
      node.hidden = !this.fileRows.some(
        (file) => file.path.startsWith(`${path}/`) && !file.button.hidden,
      );
      node.open =
        query || this.status ? !node.hidden : !this.collapsed.has(path);
    }
  }
}

interface FileFolder {
  path: string;
  name: string;
  folders: Map<string, FileFolder>;
  files: Comparison["fileList"][number][];
}
