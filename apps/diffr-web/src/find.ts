import { Range } from "vs/editor/common/core/range.js";
/**
 * ⌘/Ctrl+F: find text in every diffed file, not only the lines on screen, which is all the
 * browser's own find can see of a virtualized list. A match opens the folds around it.
 */
import type { IEditorDecorationsCollection } from "vs/editor/common/editorCommon.js";

import type { Comparison } from "./comparison.js";

type Side = "original" | "modified";

interface Match {
  path: string;
  side: Side;
  /** 1-based, as the editors count. */
  line: number;
  column: number;
  length: number;
}

/** Past this, the count reads "10000+" and the rest are not stepped through. */
const MAX_MATCHES = 10_000;

function toggle(
  parent: HTMLElement,
  icon: string,
  title: string,
  onChange: () => void,
): () => boolean {
  const button = parent.appendChild(document.createElement("button"));
  button.type = "button";
  button.className = `app-find-toggle codicon codicon-${icon}`;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    button.setAttribute(
      "aria-pressed",
      String(button.getAttribute("aria-pressed") !== "true"),
    );
    onChange();
  });

  return () => button.getAttribute("aria-pressed") === "true";
}

function iconButton(
  parent: HTMLElement,
  icon: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = parent.appendChild(document.createElement("button"));
  button.type = "button";
  button.className = `app-find-button codicon codicon-${icon}`;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", onClick);

  return button;
}

export class FindBar {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly matchCase: () => boolean;
  private readonly wholeWord: () => boolean;
  private readonly regex: () => boolean;
  private matches: Match[] = [];
  private current = -1;
  private searched: Comparison | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private decorations = new Map<object, IEditorDecorationsCollection>();
  private frame = 0;

  constructor(private readonly comparison: () => Comparison | undefined) {
    this.element = document.createElement("div");
    this.element.className = "app-find";
    this.element.hidden = true;
    this.element.setAttribute("role", "search");

    const field = this.element.appendChild(document.createElement("div"));
    field.className = "app-find-field";
    this.input = field.appendChild(document.createElement("input"));
    this.input.placeholder = "Find in all files";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "Find in all files");
    const search = () => this.search();
    this.matchCase = toggle(field, "case-sensitive", "Match case", search);
    this.wholeWord = toggle(field, "whole-word", "Match whole word", search);
    this.regex = toggle(field, "regex", "Use regular expression", search);

    this.count = this.element.appendChild(document.createElement("span"));
    this.count.className = "app-find-count";
    this.count.setAttribute("aria-live", "polite");
    iconButton(this.element, "arrow-up", "Previous match (⇧Enter)", () =>
      this.step(-1),
    );
    iconButton(this.element, "arrow-down", "Next match (Enter)", () =>
      this.step(1),
    );
    iconButton(this.element, "close", "Close (Escape)", () => this.hide());

    this.input.addEventListener("input", () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(search, 120);
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        clearTimeout(this.timer);

        if (this.searched !== this.comparison() || this.current < 0)
          this.search();
        else this.step(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") this.hide();
      else return;
      event.preventDefault();
      event.stopPropagation();
    });
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Open with the page's selection, if any, as the query. */
  show(): void {
    const selection = window.getSelection()?.toString() ?? "";

    if (selection && !selection.includes("\n")) this.input.value = selection;
    this.element.hidden = false;
    this.input.focus();
    this.input.select();
    this.search();
  }

  hide(): void {
    if (this.element.hidden) return;
    this.element.hidden = true;
    this.clearDecorations();
    this.comparison()?.focus();
  }

  /** Files arrived or the comparison changed: search again, keeping the current match. */
  refresh(): void {
    if (this.element.hidden || !this.input.value) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.search(false), 250);
  }

  private pattern(): RegExp | undefined {
    const query = this.input.value;

    if (!query) return undefined;

    let source = this.regex()
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (this.wholeWord()) source = `\\b(?:${source})\\b`;

    try {
      return new RegExp(source, this.matchCase() ? "gu" : "giu");
    } catch {
      return undefined;
    }
  }

  /** Search again, from the match nearest the current one; `reveal` scrolls to it. */
  private search(reveal = true): void {
    const comparison = this.comparison();
    const previous = this.matches[this.current];
    this.searched = comparison;
    this.matches = [];
    this.current = -1;
    const pattern = this.pattern();

    if (!comparison || !pattern) {
      this.count.textContent =
        this.input.value && !pattern ? "Invalid expression" : "";
      this.element.classList.toggle(
        "no-results",
        !!this.input.value && !pattern,
      );
      this.clearDecorations();

      return;
    }

    const files = comparison.texts();
    const order = new Map(files.map(({ path }, i) => [path, i]));

    // The head side whole, and of the base side only its removed lines, so an unchanged line is
    // found once, as a unified diff shows it.
    outer: for (const file of files) {
      const removed = comparison.removedLines(file.path);

      for (const side of ["modified", "original"] as const) {
        const text = file[side];

        if (!text) continue;

        for (const [index, line] of text.split("\n").entries()) {
          if (side === "original" && !removed(index)) continue;

          for (const found of line.matchAll(pattern)) {
            if (!found[0].length) continue;
            this.matches.push({
              path: file.path,
              side,
              line: index + 1,
              column: found.index + 1,
              length: found[0].length,
            });

            if (this.matches.length >= MAX_MATCHES) break outer;
          }
        }
      }
    }

    // Reading order: file by file, line by line, a removed line before the line that replaced it.
    this.matches.sort(
      (a, b) =>
        order.get(a.path)! - order.get(b.path)! ||
        a.line - b.line ||
        (a.side === b.side ? 0 : a.side === "original" ? -1 : 1) ||
        a.column - b.column,
    );

    if (this.matches.length) {
      const index = previous
        ? this.matches.findIndex(
            (match) =>
              order.get(match.path)! > order.get(previous.path)! ||
              (match.path === previous.path &&
                (match.line > previous.line ||
                  (match.line === previous.line &&
                    match.column >= previous.column))),
          )
        : 0;

      this.current = Math.max(0, index);
    }

    this.render(reveal);
  }

  private step(by: number): void {
    if (!this.matches.length) return;
    this.current =
      (this.current + by + this.matches.length) % this.matches.length;
    this.render(true);
  }

  private render(reveal: boolean): void {
    const comparison = this.comparison();
    const total = this.matches.length;

    const pending = comparison
      ? comparison.fileList.filter((file) => !file.diffed).length
      : 0;

    this.count.textContent = !this.input.value
      ? ""
      : total
        ? `${this.current + 1} of ${total >= MAX_MATCHES ? `${MAX_MATCHES}+` : total}`
        : "No results";

    this.count.title = pending
      ? `${pending} file${pending === 1 ? "" : "s"} not diffed yet; their matches join as they load`
      : "";
    this.element.classList.toggle("no-results", !!this.input.value && !total);

    const match = this.matches[this.current];

    if (reveal && match && comparison)
      comparison.revealLine(match.path, match.side, match.line);

    this.decorate();
  }

  /** Mark the matches in the files on screen, once their editors exist. */
  private decorate(): void {
    cancelAnimationFrame(this.frame);
    const current = this.matches[this.current];
    const groups = new Map<string, Match[]>();

    for (const match of this.matches) {
      const key = `${match.side}\0${match.path}`;
      const group = groups.get(key);

      if (group) group.push(match);
      else groups.set(key, [match]);
    }

    let frames = 0;

    const apply = () => {
      const comparison = this.comparison();
      this.clearDecorations();

      if (!comparison || this.element.hidden) return;

      for (const group of groups.values()) {
        const { path, side } = group[0]!;
        const editor = comparison.codeEditor(path, side);

        // Unified, a removed line is drawn outside the editor's model.
        if (!editor || editor.getModel()?.uri.authority !== sideAuthority(side))
          continue;
        this.decorations.set(
          editor,
          editor.createDecorationsCollection(
            group.map((m) => ({
              range: new Range(m.line, m.column, m.line, m.column + m.length),
              options: {
                description: "diffr-find",
                className: m === current ? "currentFindMatch" : "findMatch",
                stickiness: 1,
              },
            })),
          ),
        );
      }

      // Files render, and a reveal settles, over the next frames.
      if (++frames < 20) this.frame = requestAnimationFrame(apply);
    };

    this.frame = requestAnimationFrame(apply);
  }

  private clearDecorations(): void {
    for (const collection of this.decorations.values()) collection.clear();
    this.decorations.clear();
  }
}

/** The authority of each side's model URIs (comparison.ts). */
const sideAuthority = (side: Side) => (side === "original" ? "base" : "head");
