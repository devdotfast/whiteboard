/**
 * The page's settings: the GitHub token, the summarizer's key, the agent's plugins, and diffr's
 * own config.toml, with a reference to what it holds. A first visit walks through the two keys,
 * each of which can be skipped.
 */
import { Engine } from "./engine/engine.js";
import { setToken, token } from "./github.js";
import {
  PROVIDERS,
  type Provider,
  type Summaries,
  configOverrides,
  readSetting,
  setSummaries,
  summaries,
  writeSetting,
} from "./settings.js";
import { actionButton, dialog, element, field, link, rich } from "./ui.js";

export interface SettingsHost {
  readonly root: HTMLElement;
  /** The engine the page diffs with. */
  engine(): Engine;
  /** Diff with `engine` from now on, and load the page again. */
  replaceEngine(engine: Engine): void;
  /** Load the page again, as after a new token. */
  reload(): void;
  /** Extra sections, such as the agent's plugins. */
  sections?: (parent: HTMLElement) => void;
}

const GITHUB_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=diffr&description=Read+pull+requests+in+diffr&contents=read&pull_requests=read";

/** Make an engine for new settings and use it once it loads; the old one stays if it fails. */
function tryEngine(
  host: SettingsHost,
  config: string | undefined,
  overrides: string | undefined,
  status: HTMLElement,
  onReady: () => void,
): void {
  const candidate = new Engine(config, overrides);
  status.textContent = "Checking…";
  candidate.notices.then(
    () => {
      onReady();
      host.replaceEngine(candidate);
    },
    (error: Error) => {
      candidate.dispose();
      status.textContent = error.message;
    },
  );
}

function tokenInput(): HTMLInputElement {
  const input = element("input");
  input.type = "password";
  input.autocomplete = "off";
  input.placeholder = "github_pat_…";
  input.value = token() ?? "";

  return input;
}

function tokenHint(): DocumentFragment {
  return rich(
    `For private repositories, and 5,000 requests an hour instead of 60. A [fine-grained token](${GITHUB_TOKEN_URL}) with read access to contents and pull requests is enough. It stays in this browser and is sent only to GitHub.`,
  );
}

interface SummaryControls {
  read(): Summaries | undefined;
}

/** Provider, key and model, filled from what is saved. */
function summaryFields(parent: HTMLElement): SummaryControls {
  const saved = summaries();
  const provider = element("select");

  for (const [value, { title }] of Object.entries(PROVIDERS)) {
    const option = provider.appendChild(element("option", undefined, title));
    option.value = value;
  }

  provider.value = saved?.provider ?? "anthropic";
  const key = element("input");
  key.type = "password";
  key.autocomplete = "off";
  key.value = saved?.apiKey ?? "";
  const keyHint = element("span");
  const model = element("input");
  model.value = saved?.model ?? "";
  model.placeholder = "The provider's default";
  model.spellcheck = false;

  const update = () => {
    // SAFETY: the options are PROVIDERS' keys.
    const details = PROVIDERS[provider.value as Provider];
    key.placeholder = details.placeholder;
    keyHint.replaceChildren(
      rich(
        `Leave it empty to turn summaries off. [Get a ${details.title} key](${details.keys}). It stays in this browser and is sent only to ${details.title}.`,
      ),
    );
  };

  provider.addEventListener("change", update);
  update();
  field(parent, "Provider", provider);
  field(parent, "API key", key, keyHint);
  field(
    parent,
    "Model",
    model,
    "Optional. A small, fast model reads best: summaries are written for every long new function.",
  );

  return {
    read: () =>
      key.value.trim()
        ? {
            // SAFETY: the options are PROVIDERS' keys.
            provider: provider.value as Provider,
            apiKey: key.value.trim(),
            model: model.value.trim() || undefined,
          }
        : undefined,
  };
}

/** A first visit: the GitHub token, then the summarizer's key. Either can be skipped. */
export function openOnboarding(host: SettingsHost): void {
  const finish = () => writeSetting("onboarded", "1");

  dialog(
    host.root,
    "Welcome to diffr",
    (node, actions) => {
      // Closing it any way counts: the page does not ask again.
      node.addEventListener("close", finish);
      const content = node.appendChild(element("div", "app-onboarding"));

      const step = (
        title: string,
        build: (content: HTMLElement) => void,
        buttons: HTMLButtonElement[],
      ) => {
        content.replaceChildren(element("h3", undefined, title));
        build(content);
        actions.replaceChildren(...buttons);
        content.querySelector<HTMLElement>("input, select")?.focus();
      };

      const summariesStep = () => {
        let controls: SummaryControls;
        const status = element("p", "app-dialog-status");

        step(
          "2 of 2 · Summaries",
          (content) => {
            content.appendChild(
              element(
                "p",
                undefined,
                "diffr can fold long new functions and tests behind short pseudocode, written by a model you choose. It needs that provider's API key.",
              ),
            );
            controls = summaryFields(content);
            content.appendChild(status);
          },
          [
            actionButton("Skip", () => node.close()),
            actionButton(
              "Finish",
              () => {
                const value = controls.read();

                if (!value) {
                  node.close();

                  return;
                }

                setSummaries(value);
                tryEngine(
                  host,
                  readSetting("config"),
                  configOverrides(),
                  status,
                  () => node.close(),
                );
              },
              true,
            ),
          ],
        );
      };

      const input = tokenInput();

      step(
        "1 of 2 · GitHub",
        (content) => {
          content.appendChild(
            element(
              "p",
              undefined,
              "diffr reads pull requests from GitHub and diffs them here, in your browser. Public repositories work without a token.",
            ),
          );
          field(content, "GitHub token", input, tokenHint());
        },
        [
          actionButton("Skip", summariesStep),
          actionButton(
            "Continue",
            () => {
              const value = input.value.trim();

              if (value !== (token() ?? "")) {
                setToken(value || null);
                host.reload();
              }

              summariesStep();
            },
            true,
          ),
        ],
      );
    },
    "app-onboarding-dialog",
  );
}

export function openSettings(host: SettingsHost): void {
  dialog(
    host.root,
    "Settings",
    (node, actions) => {
      const scroll = node.appendChild(element("div", "app-settings"));

      const section = (title: string, description?: string) => {
        const part = scroll.appendChild(element("section"));
        part.appendChild(element("h3", undefined, title));

        if (description) part.appendChild(element("p", undefined, description));

        return part;
      };

      const github = tokenInput();
      field(section("GitHub"), "Token", github, tokenHint());

      const summary = summaryFields(
        section(
          "Summaries",
          "Long new functions and tests fold behind pseudocode written by a model. Each file shows first, and its summaries follow.",
        ),
      );

      host.sections?.(scroll);

      const advanced = section("diffr configuration");
      advanced.appendChild(
        rich(
          "diffr's own `config.toml`, as the diffr command line reads it: which files start hidden, how much context stays around a change, and each bundled plugin's options. Leave it empty for diffr's defaults; anything set here applies over them. The settings above are applied over it.",
        ),
      );
      const config = advanced.appendChild(element("textarea"));
      config.spellcheck = false;
      config.value = readSetting("config") ?? "";
      config.placeholder = `# For example: keep more context, and show deleted files.
[plugins.shape.bundled.context]
lines = 8

[plugins.classify.bundled]
hide_deleted = false`;
      config.setAttribute("aria-label", "config.toml");
      advanced.appendChild(reference(host));

      const status = node.appendChild(element("p", "app-dialog-status"));
      host.engine().notices.then(
        (notices) => (status.textContent = notices.join("\n")),
        (error: Error) => (status.textContent = error.message),
      );

      actions.appendChild(actionButton("Cancel", () => node.close()));
      actions.appendChild(
        actionButton(
          "Save",
          () => {
            const tokenValue = github.value.trim() || null;
            const tokenChanged = tokenValue !== token();
            const configValue = config.value.trim() ? config.value : undefined;
            const summaryValue = summary.read();

            const engineChanged =
              configValue !== readSetting("config") ||
              JSON.stringify(summaryValue) !== JSON.stringify(summaries());

            if (tokenChanged) setToken(tokenValue);

            if (!engineChanged) {
              node.close();

              if (tokenChanged) host.reload();

              return;
            }

            const overrides = (() => {
              const saved = summaries();
              setSummaries(summaryValue);
              const value = configOverrides();
              setSummaries(saved);

              return value;
            })();

            // Tried in its own engine first, so a broken file leaves the page as it was.
            tryEngine(host, configValue, overrides, status, () => {
              writeSetting("config", configValue);
              setSummaries(summaryValue);
              node.close();
            });
          },
          true,
        ),
      );
    },
    "app-settings-dialog",
  );
}

interface Schema {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  items?: Schema;
  $ref?: string;
  $defs?: Record<string, Schema>;
  definitions?: Record<string, Schema>;
  oneOf?: Schema[];
  anyOf?: Schema[];
}

/** Every setting config.toml can hold, from diffr's schema: its key, type, default and meaning. */
function reference(host: SettingsHost): HTMLElement {
  const details = element("details", "app-config-reference");
  details.appendChild(
    element("summary", undefined, "Reference: every setting"),
  );
  const list = details.appendChild(element("dl"));
  let loaded = false;

  details.addEventListener("toggle", () => {
    if (!details.open || loaded) return;
    loaded = true;
    list.textContent = "Loading…";
    host
      .engine()
      .schema()
      .then(
        (text) => {
          // SAFETY: Differ.schema is diffr's configuration JSON Schema.
          const root = JSON.parse(text) as Schema;
          list.replaceChildren();

          const resolve = (schema: Schema): Schema => {
            const ref = schema.$ref?.match(/^#\/(\$defs|definitions)\/(.+)$/);
            const target = ref && (root.$defs ?? root.definitions)?.[ref[2]!];

            return target ? resolve(target) : schema;
          };

          const walk = (key: string, raw: Schema, depth: number) => {
            const schema = resolve(raw);

            if (schema.properties && depth < 8) {
              for (const [name, child] of Object.entries(schema.properties))
                walk(key ? `${key}.${name}` : name, child, depth + 1);

              return;
            }

            const term = list.appendChild(element("dt"));
            term.appendChild(element("code", undefined, key));

            const type = schema.enum
              ? schema.enum.map((value) => JSON.stringify(value)).join(" | ")
              : [schema.type ?? (schema.oneOf || schema.anyOf ? "value" : "")]
                  .flat()
                  .join(" | ");

            if (type)
              term.appendChild(element("span", "app-config-type", type));

            const definition = list.appendChild(element("dd"));

            if (schema.description)
              definition.appendChild(rich(schema.description));

            if (
              schema.default !== undefined &&
              schema.default !== null &&
              !(schema.default instanceof Object)
            )
              definition.appendChild(
                element(
                  "span",
                  "app-config-default",
                  `Default: ${JSON.stringify(schema.default)}`,
                ),
              );
          };

          walk("", root, 0);
        },
        (error: Error) => (list.textContent = error.message),
      );
  });

  details
    .appendChild(element("p", "app-field-hint"))
    .appendChild(
      rich(
        "The same settings as the diffr command line's `diffr config`; see [the plugin guide](https://github.com/devdotfast/whiteboard/blob/main/diffr/docs/plugin.md#configuration-format-2). The browser runs only the bundled plugins.",
      ),
    );

  return details;
}
