import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  type JsonObject,
  type JsonValue,
  isJsonObject,
  isStringValue,
  parseJsonText,
} from "@dev.fast/json";
import {
  type ReviewDiffrConfig,
  type ReviewDiffrProvider,
  type ReviewDiffrSummarizerInput,
  decodeStructuralDiffEvent,
  reviewDiffrSummarizerInputSchema,
} from "@dev.fast/review-protocol";
import { stringify } from "smol-toml";

import { invalidateStructuralComparisons } from "./structural-comparisons.js";
import { diffrExecutable, diffrMissingError } from "./structural-diff";

const execFileAsync = promisify(execFile);

let writes: Promise<unknown> = Promise.resolve();

let testing = false;

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.then(operation, operation);
  writes = next.catch(() => {});

  return next;
}

async function diffr(
  args: string[],
  rootPath?: string,
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(diffrExecutable(), args, {
      cwd: rootPath,
      maxBuffer: 16 * 1024 * 1024,
      signal: options.signal ?? AbortSignal.timeout(30_000),
      env: options.env ?? process.env,
    });

    return stdout;
  } catch (error) {
    // SAFETY: execFile rejects with an Error carrying its exit or spawn code.
    // Do not forward its message: it includes command arguments.
    const failure = error as NodeJS.ErrnoException;

    if (failure.code === "ENOENT") throw diffrMissingError();

    if (failure.name === "AbortError")
      throw new Error("diffr timed out or was cancelled.");
    throw new Error(
      "diffr could not complete the operation. Check its configuration and credentials.",
    );
  }
}

async function values(
  rootPath?: string,
  reveal = false,
  signal?: AbortSignal,
): Promise<JsonObject> {
  return json(
    await diffr(
      ["config", "show", "--json", ...(reveal ? ["--reveal"] : [])],
      rootPath,
      { signal },
    ),
  );
}

function json(output: string): JsonObject {
  try {
    const parsed = parseJsonText(output);

    if (isJsonObject(parsed)) return parsed;
  } catch {
    /* Do not echo config contents in parse errors. */
  }

  throw new Error("diffr configuration response is malformed.");
}

function valueAt(object: JsonObject, key: string): JsonValue | undefined {
  let value: JsonValue | undefined = object;

  for (const segment of key.split("."))
    value = isJsonObject(value) ? value[segment] : undefined;

  return value;
}

const prefix = "plugins.bundled.summarize";

function savedProvider(config: JsonObject): string {
  const value = valueAt(config, `${prefix}.provider`);

  return isStringValue(value) ? value : "";
}

function savedEndpoint(config: JsonObject): string {
  const value = valueAt(config, `${prefix}.endpoint`);

  return isStringValue(value) ? value : "";
}

/** Whether a saved key belongs to a different destination than the draft's. */
function movesKey(
  config: JsonObject,
  draft: Pick<ReviewDiffrSummarizerInput, "provider" | "endpoint">,
): boolean {
  return (
    draft.provider !== savedProvider(config) ||
    draft.endpoint !== savedEndpoint(config)
  );
}

function environmentKey(
  providers: ReviewDiffrProvider[],
  id: string,
): string | undefined {
  return providers
    .find((provider) => provider.id === id)
    ?.keyVariables.map((name) => process.env[name])
    .find((key) => !!key);
}

function keyOptional(
  providers: ReviewDiffrProvider[],
  id: string,
  endpoint: string,
): boolean {
  return (
    endpoint !== "" &&
    !!providers.find((provider) => provider.id === id)?.keylessCustomEndpoint
  );
}

function strings(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isStringValue) : [];
}

/**
 * What diffr's schema says about summaries: each provider's defaults, and
 * the default prompt with the link its description gives. Nothing when
 * diffr cannot describe its schema: the rest of Settings still works.
 */
async function summaryDefaults(
  rootPath?: string,
): Promise<
  Pick<ReviewDiffrConfig, "providers" | "defaultPrompt" | "defaultPromptUrl">
> {
  let schema: JsonObject;

  try {
    schema = json(await diffr(["config", "schema"], rootPath));
  } catch {
    return {};
  }

  const options = valueAt(
    schema,
    "properties.plugins.properties.bundled.properties.summarize.properties",
  );

  if (!isJsonObject(options)) return {};

  const option = (name: string) =>
    isJsonObject(options[name]) ? options[name] : {};

  const provider = option("provider");
  const titles = strings(provider["x-enum-titles"]);
  const models = valueAt(option("model"), "x-default-by.values");
  const details = valueAt(option("provider_details"), "x-default-by.values");

  const providers = strings(provider.enum).map((id, index) => {
    const detail = isJsonObject(details) ? details[id] : undefined;
    const model = isJsonObject(models) ? models[id] : undefined;
    const endpoint = isJsonObject(detail) ? detail.endpoint : undefined;

    return {
      id,
      title: titles[index] ?? id,
      model: isStringValue(model) ? model : "",
      endpoint: isStringValue(endpoint) ? endpoint : "",
      keyVariables: isJsonObject(detail) ? strings(detail.key_variables) : [],
      keylessCustomEndpoint:
        isJsonObject(detail) && detail.keyless_custom_endpoint === true,
    };
  });

  const prompt = option("system_prompt");

  const description = isStringValue(prompt.description)
    ? prompt.description
    : "";

  return {
    providers,
    defaultPrompt: isStringValue(prompt.default) ? prompt.default : undefined,
    defaultPromptUrl: /https:\/\/\S+/.exec(description)?.[0],
  };
}

async function read(rootPath?: string): Promise<ReviewDiffrConfig> {
  const config = await values(rootPath);
  const defaults = await summaryDefaults(rootPath);
  const saved = valueAt(config, `${prefix}.api_key`);

  const credentialSource =
    isStringValue(saved) && saved.length > 0
      ? "config"
      : environmentKey(defaults.providers ?? [], savedProvider(config))
        ? "environment"
        : "missing";

  const plugins = config.plugins;

  if (isJsonObject(plugins)) {
    for (const namespace of Object.values(plugins)) {
      if (!isJsonObject(namespace)) continue;

      for (const plugin of Object.values(namespace)) {
        if (isJsonObject(plugin)) delete plugin.api_key;
      }
    }
  }

  return { values: config, credentialSource, ...defaults };
}

export function readDiffrConfig(rootPath?: string): Promise<ReviewDiffrConfig> {
  return serialized(() => read(rootPath));
}

export function diffrConfigValueText(value: JsonValue): string {
  return isStringValue(value) ? value : JSON.stringify(value);
}

async function writeSettings(
  entries: [string, JsonValue][],
  rootPath?: string,
): Promise<ReviewDiffrConfig> {
  let changed = false;
  let error: string | undefined;
  const current = await values(rootPath);

  try {
    for (const [key, value] of entries) {
      if (valueAt(current, key) === value) continue;
      await diffr(
        ["config", "set", key, diffrConfigValueText(value)],
        rootPath,
      );
      changed = true;
    }
  } catch {
    error = changed
      ? "Some settings were saved before diffr rejected a change. Check the current values and try again."
      : "diffr could not save the setting. Check its configuration and the entered value.";
  } finally {
    if (changed) invalidateStructuralComparisons();
  }

  return { ...(await read(rootPath)), changed, error };
}

export function setDiffrConfigValue(
  key: string,
  value: JsonValue,
  rootPath?: string,
): Promise<ReviewDiffrConfig> {
  if (
    !/^[A-Za-z0-9_][A-Za-z0-9_-]*(\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/.test(key)
  ) {
    throw new Error("Invalid diffr config key.");
  }

  return serialized(() => writeSettings([[key, value]], rootPath));
}

export function saveDiffrSummarizer(
  input: ReviewDiffrSummarizerInput,
  rootPath?: string,
): Promise<ReviewDiffrConfig> {
  const parsed = reviewDiffrSummarizerInputSchema.safeParse(input);

  if (!parsed.success) throw new Error("Invalid summary settings.");
  const draft = parsed.data;

  return serialized(async () => {
    const current = await read(rootPath);
    const providers = current.providers ?? [];
    const moving = movesKey(current.values, draft);
    const savedKey = current.credentialSource === "config";

    if (
      draft.enabled &&
      !draft.apiKey &&
      !(savedKey && !moving) &&
      !environmentKey(providers, draft.provider) &&
      !keyOptional(providers, draft.provider, draft.endpoint)
    ) {
      return {
        ...current,
        changed: false,
        error: "Add an API key before enabling summaries.",
      };
    }

    const entries: [string, JsonValue][] = [];

    if (!draft.enabled) entries.push([`${prefix}.enabled`, false]);

    // Clear a key before its destination changes and write a new one only
    // after, so a failure part way never pairs a key with another vendor.
    if (moving && savedKey) entries.push([`${prefix}.api_key`, ""]);
    entries.push([`${prefix}.provider`, draft.provider]);

    if (draft.endpoint !== savedEndpoint(current.values))
      entries.push([`${prefix}.endpoint`, draft.endpoint]);

    if (draft.apiKey) entries.push([`${prefix}.api_key`, draft.apiKey]);

    // A blank prompt leaves diffr's own in place.
    if (
      draft.systemPrompt.trim() &&
      draft.systemPrompt !== valueAt(current.values, `${prefix}.system_prompt`)
    )
      entries.push([`${prefix}.system_prompt`, draft.systemPrompt]);

    entries.push(
      [`${prefix}.model`, draft.model],
      [`${prefix}.tests`, draft.tests],
    );

    if (draft.enabled) entries.push([`${prefix}.enabled`, true]);

    return writeSettings(entries, rootPath);
  });
}

export async function testDiffrSummarizer(
  input: ReviewDiffrSummarizerInput,
  rootPath?: string,
  signal?: AbortSignal,
): Promise<string> {
  const parsed = reviewDiffrSummarizerInputSchema.safeParse(input);

  if (!parsed.success) throw new Error("Invalid summary settings.");

  if (testing) throw new Error("A summary test is already running.");
  testing = true;
  const timeout = AbortSignal.timeout(60_000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let directory: string | undefined;

  try {
    const config = await serialized(() => values(rootPath, true, deadline));
    const saved = valueAt(config, prefix);

    if (!isJsonObject(saved))
      throw new Error("The summarizer is not available in this configuration.");

    const { provider, endpoint, model, systemPrompt } = parsed.data;
    const providers = (await summaryDefaults(rootPath)).providers ?? [];

    const variables =
      providers.find((known) => known.id === provider)?.keyVariables ?? [];

    const apiKey =
      parsed.data.apiKey ||
      (!movesKey(config, parsed.data) && isStringValue(saved.api_key)
        ? saved.api_key
        : "") ||
      environmentKey(providers, provider);

    if (!apiKey && !keyOptional(providers, provider, endpoint))
      throw new Error("Add an API key to test summaries.");
    directory = await mkdtemp(join(tmpdir(), "review-summary-"));

    const options: JsonObject = {
      ...saved,
      enabled: true,
      provider,
      model,
      ...(systemPrompt.trim() && { system_prompt: systemPrompt }),
      min_lines: 1,
      retries: 0,
      request_timeout_ms: 45_000,
    };

    delete options.api_key;
    // Resolved for the saved provider; diffr derives the draft provider's.
    delete options.provider_details;

    if (endpoint) options.endpoint = endpoint;
    else delete options.endpoint;
    await mkdir(join(directory, "diffr"));
    await writeFile(
      join(directory, "diffr", "config.toml"),
      stringify({
        version: 1,
        plugins: {
          order: ["bundled.summarize"],
          bundled: { summarize: options },
        },
      }),
      { mode: 0o600 },
    );

    const before = join(directory, "before.rs"),
      after = join(directory, "after.rs");

    await writeFile(before, "");
    await writeFile(after, SUMMARY_SAMPLE);

    const output = await diffr(
      [
        "--no-index",
        "--format",
        "ndjson",
        "--stream-annotations",
        "--",
        before,
        after,
      ],
      directory,
      {
        env: {
          ...process.env,
          ...Object.fromEntries(
            providers
              .flatMap((known) => known.keyVariables)
              .map((name) => [name, ""]),
          ),
          ...(apiKey && variables[0] && { [variables[0]]: apiKey }),
          XDG_CONFIG_HOME: directory,
        },
        signal: deadline,
      },
    );

    try {
      const events = output.trim().split("\n").map(decodeStructuralDiffEvent);
      const complete = events.at(-1);

      const annotation = events
        .flatMap((event) =>
          event.type === "annotations" ? event.annotations : [],
        )
        .find((item) => item.label.trim());

      if (
        complete?.type === "complete" &&
        complete.failed === 0 &&
        !complete.aborted &&
        !events.some(
          (event) =>
            (event.type === "annotations" || event.type === "file") &&
            event.error,
        ) &&
        annotation
      ) {
        return apiKey
          ? annotation.label.split(apiKey).join("[redacted]")
          : annotation.label;
      }
    } catch {
      /* Never return provider output or parser causes. */
    }

    throw new Error(
      "No summary was produced. Check the API key, model, and network connection.",
    );
  } finally {
    testing = false;

    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

const SUMMARY_SAMPLE = `pub fn count_values(values: &[i32]) -> (i32, i32) {
    let mut total = 0;
    let mut count = 0;
    for value in values {
        if *value > 0 {
            total += value;
            count += 1;
        }
    }
    let average = if count > 0 {
        total / count
    } else {
        0
    };
    (count, average)
}
`;
