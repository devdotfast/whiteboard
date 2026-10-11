/** The settings' list of plugins agents installed (agent.ts): each one's code, on or off, or gone. */
import { Engine } from "./engine/engine.js";
import {
  type AgentPlugin,
  agentPlugins,
  configOverrides,
  readSetting,
  setAgentPlugins,
} from "./settings.js";
import { actionButton, element, rich } from "./ui.js";

export function agentPluginsSection(
  parent: HTMLElement,
  replaceEngine: (engine: Engine) => void,
): void {
  const section = parent.appendChild(element("section"));
  section.appendChild(element("h3", undefined, "Agent plugins"));
  section
    .appendChild(element("p"))
    .appendChild(
      rich(
        "Plugins an agent wrote for this page through its WebMCP tools (`diffr_install_plugin`). Each folds parts of a file diffr's own plugins leave open, runs on every comparison in this browser. It runs as any script on this page does, so keep only code you trust.",
      ),
    );
  const list = section.appendChild(element("ul", "app-plugin-list"));
  const status = section.appendChild(element("p", "app-dialog-status"));

  const apply = (next: AgentPlugin[]) => {
    const previous = agentPlugins();
    setAgentPlugins(next);
    const engine = new Engine(readSetting("config"), configOverrides());
    status.textContent = "Checking…";
    engine.notices.then(
      (notices) => {
        status.textContent = notices.join("\n");
        replaceEngine(engine);
        render();
      },
      (error: Error) => {
        engine.dispose();
        setAgentPlugins(previous);
        status.textContent = error.message;
      },
    );
  };

  const render = () => {
    list.replaceChildren();
    const plugins = agentPlugins();

    if (!plugins.length)
      list.appendChild(element("li", "app-plugin-empty", "None yet."));

    for (const plugin of plugins) {
      const row = list.appendChild(element("li", "app-plugin"));
      const toggle = element("input");
      toggle.type = "checkbox";
      toggle.checked = plugin.enabled;
      toggle.setAttribute("aria-label", `Run ${plugin.name}`);
      toggle.addEventListener("change", () =>
        apply(
          plugins.map((other) =>
            other === plugin ? { ...other, enabled: toggle.checked } : other,
          ),
        ),
      );
      const head = row.appendChild(element("div", "app-plugin-head"));
      head.appendChild(toggle);
      head.appendChild(element("strong", undefined, plugin.name));
      head.appendChild(element("span", "app-spacer"));
      head.appendChild(
        actionButton("Remove", () =>
          apply(plugins.filter((other) => other !== plugin)),
        ),
      );
      row.appendChild(element("p", undefined, plugin.description));
      const code = row.appendChild(element("details"));
      code.appendChild(element("summary", undefined, "Code"));
      code.appendChild(element("pre")).textContent = plugin.code;
    }
  };

  render();
}
