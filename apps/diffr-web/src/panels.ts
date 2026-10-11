/** The diff stats (F2) and engine (F3) panels: a card over the foot of the file tree. */
import type { Comparison } from "./comparison.js";
import { engineStats } from "./engine/engine.js";
import { readSetting, writeSetting } from "./settings.js";

type Panel = "stats" | "engine";

/** A label, its value, and what the value means. */
type Row = [label: string, value: string, tooltip?: string];

const number = (n: number) => n.toLocaleString("en");

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

export class Panels {
  readonly element: HTMLElement;
  private readonly open = new Set<Panel>();
  private frame = 0;

  constructor(private readonly comparison: () => Comparison | undefined) {
    this.element = document.createElement("div");
    this.element.className = "app-panels";

    for (const panel of ["stats", "engine"] as const)
      if (readSetting(`panel.${panel}`) === "1") this.open.add(panel);
    this.render();
  }

  isOpen(panel: Panel): boolean {
    return this.open.has(panel);
  }

  toggle(panel: Panel): void {
    if (this.open.has(panel)) this.open.delete(panel);
    else this.open.add(panel);
    writeSetting(`panel.${panel}`, this.open.has(panel) ? "1" : undefined);
    this.render();
  }

  /** Redraw on the next frame; work updates arrive per file. */
  update(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render(): void {
    const comparison = this.comparison();
    this.element.replaceChildren();
    this.element.hidden = !comparison || !this.open.size;

    if (!comparison) return;

    if (this.open.has("stats"))
      this.section("Diff stats", "F2", this.stats(comparison));

    if (this.open.has("engine"))
      this.section("Engine", "F3", this.engine(comparison));
  }

  private section(title: string, key: string, rows: Row[]): void {
    const section = this.element.appendChild(document.createElement("section"));
    const head = section.appendChild(document.createElement("h2"));
    head.textContent = title;
    head.title = `${key} to close`;

    for (const [label, value, tooltip] of rows) {
      const row = section.appendChild(document.createElement("div"));
      row.className = "app-panel-row";

      if (tooltip) row.title = tooltip;
      row.appendChild(document.createElement("span")).textContent = label;
      row.appendChild(document.createElement("span")).textContent = value;
    }
  }

  private stats(comparison: Comparison): Row[] {
    const { work } = comparison;
    const counts = comparison.counts;

    const rows: Row[] = [
      ["Files", number(comparison.fileCount)],
      [
        "Additions",
        number(counts.added),
        "diffr's counts once every file is diffed; GitHub's until then",
      ],
      ["Deletions", number(counts.removed)],
      [
        "Diffed by diffr",
        `${number(work.diffed)} / ${number(comparison.fileCount)}`,
        "Files near the screen go first; hidden files last",
      ],
    ];

    if (work.hidden)
      rows.push([
        "Hidden by diffr",
        number(work.hidden),
        "Generated, vendored and lock files, folded until opened",
      ]);

    const fallbacks = comparison.fallbacks;

    if (fallbacks.length)
      rows.push([
        "Line diff",
        number(fallbacks.length),
        fallbacks.map(({ path, message }) => `${path}: ${message}`).join("\n"),
      ]);

    if (work.failed) rows.push(["Failed", number(work.failed)]);

    return rows;
  }

  private engine(comparison: Comparison): Row[] {
    const stats = engineStats();
    const { timing, work } = comparison;
    const at = (ms?: number) => (ms === undefined ? "…" : seconds(ms));

    const rows: Row[] = [
      [
        "Workers",
        `${stats.workers} of ${stats.maxWorkers}`,
        "Workers grow while files queue and shrink after ten idle seconds",
      ],
      ["Engine download", stats.bytes ? megabytes(stats.bytes) : "…"],
      ["Engine compiled", at(stats.compiled)],
      [
        "Worker ready",
        stats.ready === undefined ? "…" : seconds(stats.ready),
        "Loading the module and the configuration in a worker",
      ],
      ["Files listed", at(timing.listed)],
      ["Files previewed", at(timing.previewed)],
      ["First diff", at(timing.firstDiff)],
      ["All diffed", at(timing.done)],
      ["Fetching", number(work.fetching)],
      ["Diffing", number(work.diffing)],
      [
        "Engine time",
        work.diffed ? seconds(work.diffMs) : "…",
        "Time diffr spent across all workers",
      ],
    ];

    if (work.slowest)
      rows.push(["Slowest", seconds(work.slowest.ms), work.slowest.path]);
    rows.push([
      "Memory",
      stats.memory ? megabytes(stats.memory) : "…",
      "The largest wasm memory a worker holds; it never shrinks",
    ]);

    return rows;
  }
}
