/**
 * The page: a landing form, or one pull request or comparison at `/owner/repo/pull/N` or
 * `/owner/repo/compare/base...head`. Everything runs here; GitHub is the only server it talks to.
 */
import "vs/base/browser/ui/codicons/codiconStyles.js";
import { observableValue } from "vs/base/common/observable.js";

import "./fonts.css";
import "./styles.css";
import "./editorFont.js";
import { loadCacheUsage, onCacheChange } from "./cache.js";
import { cacheSection } from "./cacheSection.js";
import { Comparison } from "./comparison.js";
import { Engine, onEngineChange } from "./engine/engine.js";
import { FindBar } from "./find.js";
import { parseTarget, targetPath } from "./github.js";
import { renderLensBar } from "./lenses.js";
import { Panels } from "./panels.js";
import { agentPluginsSection } from "./pluginsSection.js";
import { quickOpen } from "./quickOpen.js";
import { ReviewDiffLayoutSetting } from "./review/services/reviewDiffLayout.js";
import { configOverrides, readSetting } from "./settings.js";
import {
  type SettingsHost,
  openOnboarding,
  openSettings,
} from "./settingsDialog.js";
import { StandaloneServices } from "./standalone/browser/standaloneServices.js";
import { applyTheme } from "./theme.js";
import { actionButton, element } from "./ui.js";

const instantiation = StandaloneServices.initialize({});

const layout = new ReviewDiffLayoutSetting();

const wordWrap = observableValue("wordWrap", false);

const root = document.getElementById("app")!;

// Review Desktop's stylesheet is scoped to its workbench; the theme's variables to Monaco components.
root.className = "app monaco-workbench review-workbench monaco-component";

applyTheme(root);

const header = root.appendChild(element("header", "app-header"));

const status = root.appendChild(element("div", "app-status"));

status.hidden = true;

status.setAttribute("role", "status");

const statusMessage = status.appendChild(element("span", "app-status-message"));

const retry = status.appendChild(actionButton("Retry", route));

const openSettingsButton = status.appendChild(
  actionButton("Settings", () => openSettings(settings)),
);

const dismiss = status.appendChild(
  actionButton("Dismiss", () => {
    summaryNoticeDismissed = true;
    renderHeader();
  }),
);

const lensBar = root.appendChild(element("nav", "app-lens-bar"));

lensBar.hidden = true;

lensBar.setAttribute("aria-label", "Lenses");

/** The reader closed this comparison's notice that summaries failed. */
let summaryNoticeDismissed = false;

const body = root.appendChild(element("main", "app-body"));

const overflow = root.appendChild(element("div", "monaco-editor app-overflow"));

let engine: Engine | undefined;

let comparison: Comparison | undefined;

const panels = new Panels(() => comparison);

root.appendChild(panels.element);

const find = new FindBar(() => comparison);

body.appendChild(find.element);

onEngineChange(() => panels.update());

onCacheChange(() => panels.update());

loadCacheUsage();

function iconButton(
  icon: string,
  tooltip: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = element("button", `app-icon-button codicon codicon-${icon}`);
  button.title = tooltip;
  button.setAttribute("aria-label", tooltip);
  button.addEventListener("click", onClick);

  return button;
}

/** One engine for the page, remade when the configuration changes. */
function currentEngine(): Engine {
  return (engine ??= new Engine(readSetting("config"), configOverrides()));
}

const settings: SettingsHost = {
  root,
  engine: currentEngine,
  replaceEngine(next) {
    engine?.dispose();
    engine = next;
    route();
  },
  reload: () => route(),
  sections: (parent) => {
    cacheSection(parent);
    agentPluginsSection(parent, (next) => settings.replaceEngine(next));
  },
};

// Only where the browser offers its agent the page's tools, which bring their own decoder.
if (document.modelContext ?? navigator.modelContext)
  void import("./agent.js").then(({ registerAgentTools }) =>
    registerAgentTools({
      comparison: () => comparison,
      replaceEngine: (next) => settings.replaceEngine(next),
      changed: () => {
        renderLensBar(lensBar, comparison);
        panels.update();
      },
    }),
  );

function route(): void {
  comparison?.dispose();
  comparison = undefined;
  summaryNoticeDismissed = false;
  find.hide();
  body.replaceChildren(find.element);
  const target = parseTarget(location.pathname);

  if (!target) {
    document.title = "diffr";
    renderHeader();
    renderLensBar(lensBar, undefined);
    renderLanding();
    panels.update();

    return;
  }

  const container = body.appendChild(element("div", "app-comparison"));

  const current = (comparison = new Comparison(
    container,
    overflow,
    target,
    currentEngine(),
    layout,
    wordWrap,
    instantiation,
  ));

  const update = () => {
    if (comparison !== current) return;
    document.title = current.title ? `${current.title} · diffr` : "diffr";
    renderHeader();
    renderLensBar(lensBar, current);
    panels.update();
    find.refresh();
  };

  current.onDidChange(update);
  update();
}

function renderHeader(): void {
  const focusedButton = Array.from(header.querySelectorAll("button")).findIndex(
    (button) => button === document.activeElement,
  );

  header.replaceChildren();
  const error = comparison?.error;

  const loading =
    comparison && !comparison.preview && !comparison.change && !error;

  const summaryErrors = comparison?.work.summaryErrors ?? [];

  const summaryNotice =
    !error && !loading && !summaryNoticeDismissed && summaryErrors.length
      ? `Summaries failed for ${summaryErrors.length} file${summaryErrors.length === 1 ? "" : "s"}: ${summaryErrors[0]!.message}`
      : undefined;

  status.hidden = !error && !loading && !summaryNotice;
  status.classList.toggle("is-error", !!error || !!summaryNotice);
  status.setAttribute("role", error || summaryNotice ? "alert" : "status");
  statusMessage.textContent =
    error ?? summaryNotice ?? (loading ? "Loading comparison…" : "");
  retry.hidden = !error;
  openSettingsButton.hidden = dismiss.hidden = !summaryNotice;
  const home = header.appendChild(element("a", "app-wordmark", "diffr"));
  home.href = "/";
  home.title = "Open another pull request";
  home.addEventListener("click", (event) => {
    event.preventDefault();
    navigate("/");
  });

  if (comparison) {
    const title = header.appendChild(
      element(
        "a",
        "app-title",
        comparison.title ?? targetPath(comparison.target).slice(1),
      ),
    );

    if (comparison.url) {
      title.href = comparison.url;
      title.target = "_blank";
      title.rel = "noopener";
      title.title = `Open on GitHub · ${targetPath(comparison.target).slice(1)}`;
    }
  }

  header.appendChild(element("span", "app-spacer"));

  if (comparison) {
    for (const [panel, icon, label] of [
      ["stats", "graph", "Diff stats (F2)"],
      ["engine", "dashboard", "Engine stats (F3)"],
    ] as const) {
      const button = iconButton(icon, label, () => togglePanel(panel));
      button.setAttribute("aria-pressed", String(panels.isOpen(panel)));
      header.appendChild(button);
    }

    header.appendChild(
      iconButton("layout-sidebar-left", "Toggle file tree (⌘/Ctrl+B)", () =>
        comparison?.toggleFileTree(),
      ),
    );

    const wrap = iconButton("word-wrap", "Toggle word wrap (W)", () => {
      wordWrap.set(!wordWrap.get(), undefined);
      renderHeader();
    });

    wrap.setAttribute("aria-pressed", String(wordWrap.get()));
    header.appendChild(wrap);
    const split = layout.get() === "split";
    header.appendChild(
      iconButton(
        split ? "split-horizontal" : "list-flat",
        split ? "Split · show unified" : "Unified · show split",
        () => {
          void layout.toggle().then(renderHeader);
        },
      ),
    );
  }

  header.appendChild(
    iconButton(
      "settings-gear",
      "Settings: GitHub token, summaries, diffr",
      () => openSettings(settings),
    ),
  );

  if (focusedButton >= 0) {
    const button = header.querySelectorAll("button").item(focusedButton);
    button?.focus({ preventScroll: true });
  }
}

function togglePanel(panel: "stats" | "engine"): void {
  panels.toggle(panel);
  renderHeader();
}

function renderLanding(): void {
  const landing = body.appendChild(element("form", "app-landing"));
  landing.appendChild(element("h1", undefined, "diffr"));
  landing.appendChild(
    element(
      "p",
      undefined,
      "Structural diffs of GitHub pull requests, worked out in your browser.",
    ),
  );
  const input = landing.appendChild(element("input"));
  input.placeholder = "github.com/owner/repo/pull/123";
  input.setAttribute("aria-label", "Pull request or comparison URL");
  input.autofocus = true;
  const error = landing.appendChild(element("p", "app-landing-error"));
  landing.addEventListener("submit", (event) => {
    event.preventDefault();
    const target = parseTarget(input.value);

    if (target) navigate(targetPath(target));
    else
      error.textContent =
        "A pull request or compare URL, like github.com/owner/repo/pull/123";
  });
  input.focus();
}

function navigate(path: string): void {
  if (path !== location.pathname) history.pushState(null, "", path);
  route();
}

window.addEventListener("popstate", route);

/** A `z` waiting for its fold command. */
let chord = false;

/** The diffr TUI's keys, besides its menus and panning, which the page has as clicks and scrolls. */
function command(event: KeyboardEvent): (() => void) | undefined {
  // A shifted letter, as some keyboards and input tools report it.
  const key =
    event.shiftKey && event.key.length === 1
      ? event.key.toUpperCase()
      : event.key;

  if (key === "F2" || key === "F3")
    return () => togglePanel(key === "F2" ? "stats" : "engine");

  if (!comparison) return undefined;
  const current = comparison;

  if ((event.metaKey || event.ctrlKey) && !event.altKey) {
    if (key === "b") return () => current.toggleFileTree();

    // The browser's own find sees only the lines on screen; print has nothing to print.
    if (key === "f") return () => find.show();

    if (key === "p")
      return () =>
        quickOpen(body, current.fileList, (path) => current.openFile(path));
  }

  // Plain keys only, and never while typing. The editors are read only, so their input area types
  // nothing.
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  const target = event.target;

  if (
    (target instanceof Element &&
      target.closest("input, dialog, .find-widget")) ||
    (target instanceof HTMLTextAreaElement &&
      !target.classList.contains("inputarea"))
  )
    return undefined;

  // Space activates a focused control. The diff scrolling shortcut must not steal that action.
  if (
    key === " " &&
    target instanceof Element &&
    target.closest("button, a[href], [role=checkbox], [role=button]")
  )
    return undefined;

  // Shift, for a capital, is pressed before the letter it shifts.
  if (["Shift", "Alt", "Control", "Meta"].includes(key)) return undefined;

  if (chord) {
    chord = false;

    if (key === "M" || key === "R") return () => current.foldAll(key === "M");

    return "aocAOCjk".includes(key) && key.length === 1
      ? () => current.foldCommand(key)
      : undefined;
  }

  const viewport =
    (document.querySelector(".app-comparison")?.clientHeight ?? 0) - 2 * LINE;

  const keys = new Map<string, () => void>([
    ["z", () => (chord = true)],
    ["]", () => current.goToChange("next")],
    ["[", () => current.goToChange("previous")],
    ["s", () => void layout.toggle().then(renderHeader)],
    [
      "w",
      () => {
        wordWrap.set(!wordWrap.get(), undefined);
        renderHeader();
      },
    ],
    ["c", () => current.toggleContextGaps()],
    ["i", () => togglePanel("stats")],
    ["\\", () => current.toggleFileTree()],
    ["j", () => current.scroll(LINE)],
    ["k", () => current.scroll(-LINE)],
    ["d", () => current.scroll(viewport / 2)],
    ["u", () => current.scroll(-viewport / 2)],
    ["f", () => current.scroll(viewport)],
    [" ", () => current.scroll(event.shiftKey ? -viewport : viewport)],
    ["b", () => current.scroll(-viewport)],
    ["g", () => current.scroll("top")],
    ["G", () => current.scroll("end")],
  ]);

  return keys.get(key);
}

/** One row of the diff, in pixels: the editor's 12px font at Monaco's line height. */
const LINE = 18;

// Capturing, so a read-only editor never answers a letter with its "cannot edit" note.
window.addEventListener(
  "keydown",
  (event: KeyboardEvent) => {
    const run = command(event);

    if (!run) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  },
  true,
);

route();

if (!readSetting("onboarded")) openOnboarding(settings);
