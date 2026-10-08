/** Per-browser preferences. Storage can be missing or refuse (private windows), so every access may fail quietly. */
const PREFIX = "diffr.";

export function readSetting(key: string): string | undefined {
  try {
    return localStorage.getItem(PREFIX + key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeSetting(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Not remembered.
  }
}

/** The model APIs the summarizer can call (diffr/plugins/shape/summarize). */
export const PROVIDERS = {
  anthropic: {
    title: "Anthropic",
    keys: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-…",
  },
  openai: {
    title: "OpenAI",
    keys: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
  gemini: {
    title: "Gemini",
    keys: "https://aistudio.google.com/apikey",
    placeholder: "AIza…",
  },
} as const;

export type Provider = keyof typeof PROVIDERS;

/** The summarizer's key and model; none, and it stays off. */
export interface Summaries {
  provider: Provider;
  apiKey: string;
  /** Unset uses the provider's default. */
  model?: string;
}

export function summaries(): Summaries | undefined {
  try {
    // SAFETY: setSummaries wrote it; a value without a key or a known provider is ignored below.
    const value = JSON.parse(
      readSetting("summaries") ?? "null",
    ) as Summaries | null;

    return value?.apiKey && value.provider in PROVIDERS ? value : undefined;
  } catch {
    return undefined;
  }
}

export function setSummaries(value: Summaries | undefined): void {
  writeSetting("summaries", value ? JSON.stringify(value) : undefined);
}

/** The page's settings as diffr configuration, merged over the reader's config.toml. */
export function configOverrides(): string | undefined {
  const summary = summaries();

  if (!summary) return undefined;

  return JSON.stringify({
    plugins: {
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- diffr's config key.
      shape: {
        bundled: {
          summarize: {
            enabled: true,
            provider: summary.provider,
            api_key: summary.apiKey,
            // Unset, it is left out: JSON has no undefined.
            model: summary.model,
          },
        },
      },
    },
  });
}

/** A shape plugin an agent wrote for this page (agent.ts), run in the workers after diffr's own. */
export interface AgentPlugin {
  name: string;
  description: string;
  /** The source of one JavaScript function, `(file) => void`. */
  code: string;
  enabled: boolean;
}

export function agentPlugins(): AgentPlugin[] {
  try {
    // SAFETY: setAgentPlugins wrote it.
    const value = JSON.parse(readSetting("plugins") ?? "[]") as AgentPlugin[];

    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function setAgentPlugins(plugins: readonly AgentPlugin[]): void {
  writeSetting("plugins", plugins.length ? JSON.stringify(plugins) : undefined);
}
