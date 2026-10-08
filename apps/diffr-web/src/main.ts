/**
 * The page: a landing form, or one pull request or comparison at `/owner/repo/pull/N` or
 * `/owner/repo/compare/base...head`. Everything runs here; GitHub is the only server it talks to.
 */
import "vs/base/browser/ui/codicons/codiconStyles.js";
import "./fonts.css";
import "./styles.css";
import { Comparison } from "./comparison.js";
import { Engine, onEngineChange } from "./engine/engine.js";
import { parseTarget, setToken, targetPath, token } from "./github.js";
import { Panels } from "./panels.js";
import { ReviewDiffLayoutSetting } from "./review/services/reviewDiffLayout.js";
import { readSetting, writeSetting } from "./settings.js";
import { StandaloneServices } from "./standalone/browser/standaloneServices.js";
import { applyTheme } from "./theme.js";

const instantiation = StandaloneServices.initialize({});

const layout = new ReviewDiffLayoutSetting();

const root = document.getElementById("app")!;

// Review Desktop's stylesheet is scoped to its workbench; the theme's variables to Monaco components.
root.className = "app monaco-workbench review-workbench monaco-component";

applyTheme(root);

const header = root.appendChild(element("header", "app-header"));

const body = root.appendChild(element("main", "app-body"));

const overflow = root.appendChild(element("div", "monaco-editor app-overflow"));

let engine: Engine | undefined;

let comparison: Comparison | undefined;

const panels = new Panels(() => comparison);

root.appendChild(panels.element);

onEngineChange(() => panels.update());

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (className) node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
}

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
  return (engine ??= new Engine(readSetting("config")));
}

function route(): void {
  comparison?.dispose();
  comparison = undefined;
  body.replaceChildren();
  const target = parseTarget(location.pathname);

  if (!target) {
    document.title = "diffr";
    renderHeader();
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
    instantiation,
  ));

  const update = () => {
    if (comparison !== current) return;
    document.title = current.title ? `${current.title} · diffr` : "diffr";
    renderHeader();
    panels.update();
  };

  current.onDidChange(update);
  update();
}

function renderHeader(): void {
  header.replaceChildren();
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

    if (comparison.error)
      header.appendChild(element("span", "app-error", comparison.error));
  }

  header.appendChild(element("span", "app-spacer"));

  if (comparison) {
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
    iconButton("settings-gear", "diffr configuration", openConfig),
  );
  header.appendChild(
    iconButton(
      token() ? "unlock" : "key",
      token() ? "GitHub token set" : "Add a GitHub token",
      openToken,
    ),
  );
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

function dialog(
  title: string,
  build: (dialog: HTMLDialogElement, actions: HTMLElement) => void,
): void {
  const node = root.appendChild(element("dialog", "app-dialog"));
  node.appendChild(element("h2", undefined, title));
  const actions = element("div", "app-dialog-actions");
  build(node, actions);
  node.appendChild(actions);
  node.addEventListener("close", () => node.remove());
  node.showModal();
}

function actionButton(
  label: string,
  onClick: () => void,
  primary = false,
): HTMLButtonElement {
  const button = element(
    "button",
    primary ? "app-button primary" : "app-button",
    label,
  );

  button.type = "button";
  button.addEventListener("click", onClick);

  return button;
}

function openToken(): void {
  dialog("GitHub token", (node, actions) => {
    node.appendChild(
      element(
        "p",
        undefined,
        "For private repositories, and GitHub's higher rate limit. It stays in this browser and is sent only to GitHub.",
      ),
    );
    const input = node.appendChild(element("input"));
    input.type = "password";
    input.placeholder = "github_pat_…";
    input.value = token() ?? "";
    input.setAttribute("aria-label", "GitHub token");

    const save = (value: string | null) => {
      setToken(value);
      node.close();
      route();
    };

    if (token()) actions.appendChild(actionButton("Remove", () => save(null)));
    actions.appendChild(actionButton("Cancel", () => node.close()));
    actions.appendChild(
      actionButton("Save", () => save(input.value.trim() || null), true),
    );
  });
}

function openConfig(): void {
  dialog("diffr configuration", (node, actions) => {
    node.appendChild(
      element(
        "p",
        undefined,
        "diffr's config.toml: file tags, hidden files and plugins. It stays in this browser.",
      ),
    );
    const input = node.appendChild(element("textarea"));
    input.spellcheck = false;
    input.value = readSetting("config") ?? "";
    input.placeholder = "# diffr's defaults";
    input.setAttribute("aria-label", "config.toml");
    const status = node.appendChild(element("p", "app-dialog-status"));

    const show = (candidate: Engine) => {
      candidate.notices.then(
        (notices) => (status.textContent = notices.join("\n")),
        (error: Error) => (status.textContent = error.message),
      );
    };

    show(currentEngine());
    actions.appendChild(actionButton("Cancel", () => node.close()));
    actions.appendChild(
      actionButton(
        "Save",
        () => {
          const config = input.value.trim() ? input.value : undefined;
          // Tried in its own engine first, so a broken file leaves the page as it was.
          const candidate = new Engine(config);
          status.textContent = "Checking…";
          candidate.notices.then(
            () => {
              writeSetting("config", config);
              engine?.dispose();
              engine = candidate;
              node.close();
              route();
            },
            (error: Error) => {
              candidate.dispose();
              status.textContent = error.message;
            },
          );
        },
        true,
      ),
    );
  });
}

window.addEventListener("popstate", route);

window.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key !== "F2" && event.key !== "F3") return;
  event.preventDefault();
  panels.toggle(event.key === "F2" ? "stats" : "engine");
});

route();
