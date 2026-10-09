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
  type StructuralRegion,
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

type DiffrArguments =
  | { command: "schema" }
  | { command: "show"; reveal: boolean }
  | { command: "set"; patch: JsonObject }
  | { command: "migrate" }
  | { command: "diff"; before: string; after: string };

function diffrArgv(args: DiffrArguments): string[] {
  switch (args.command) {
    case "schema":
      return ["config", "schema"];
    case "show":
      return ["config", "show", "--json", ...(args.reveal ? ["--reveal"] : [])];
    case "set":
      return ["config", "set", "-", "--json"];
    case "migrate":
      return ["config", "migrate", "--json"];
    case "diff":
      return [
        "--no-index",
        "--format",
        "ndjson",
        "--",
        args.before,
        args.after,
      ];
  }
}

async function diffr(
  args: DiffrArguments,
  rootPath?: string,
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const executable = diffrExecutable();

  try {
    const operation = execFileAsync(executable, diffrArgv(args), {
      cwd: rootPath,
      maxBuffer: 16 * 1024 * 1024,
      signal: options.signal ?? AbortSignal.timeout(30_000),
      env: options.env ?? process.env,
    });

    if (args.command === "set")
      operation.child.stdin?.end(JSON.stringify(args.patch));
    const { stdout } = await operation;

    return stdout;
  } catch (error) {
    // SAFETY: execFile adds the exit or spawn code and stdout to its Error.
    // Do not forward its message: it includes command arguments.
    const failure = error as NodeJS.ErrnoException & { stdout?: string };

    if (failure.code === "ENOENT") throw diffrMissingError();

    if (failure.name === "AbortError")
      throw new Error("diffr timed out or was cancelled.");

    if (
      (args.command === "set" || args.command === "migrate") &&
      failure.stdout
    ) {
      let details: JsonValue | undefined;

      try {
        details = parseJsonText(failure.stdout);
      } catch {
        /* Do not echo raw output in parse errors. */
      }

      if (
        isJsonObject(details) &&
        isJsonObject(details.error) &&
        isStringValue(details.error.message)
      ) {
        const { message, repair_prompt: prompt } = details.error;
        throw new Error(
          isStringValue(prompt)
            ? `${message}\n\nCopy this as a prompt to your coding agent:\n${prompt}`
            : message,
        );
      }
    }

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
  return json(await diffr({ command: "show", reveal }, rootPath, { signal }));
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

const prefix = "plugins.shape.bundled.summarize";

function savedProvider(config: JsonObject): string {
  const value = valueAt(config, `${prefix}.provider`);

  return isStringValue(value) ? value : "";
}

/** Whether a saved key belongs to a different destination than the draft's. */
function movesKey(
  config: JsonObject,
  draft: Pick<ReviewDiffrSummarizerInput, "provider" | "endpoint">,
): boolean {
  const endpoint = valueAt(config, `${prefix}.endpoint`);

  return (
    draft.provider !== savedProvider(config) ||
    draft.endpoint !== (isStringValue(endpoint) ? endpoint : "")
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
 * Defaults supplied by diffr's schema for tag hiding and summary controls.
 * If the schema cannot be read, resolved settings still work.
 */
async function configDefaults(
  rootPath?: string,
): Promise<
  Pick<ReviewDiffrConfig, "providers" | "defaultPrompt" | "defaultHiddenTags">
> {
  let schema: JsonObject;

  try {
    schema = json(await diffr({ command: "schema" }, rootPath));
  } catch {
    return {};
  }

  const options = valueAt(
    schema,
    "properties.plugins.properties.shape.properties.bundled.properties.summarize.properties",
  );

  const defaultHiddenTags = strings(
    valueAt(
      schema,
      "properties.plugins.properties.classify.properties.bundled.properties.hide.default",
    ),
  );

  if (!isJsonObject(options)) return { defaultHiddenTags };

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

  return {
    defaultHiddenTags,
    providers,
    defaultPrompt: isStringValue(prompt.default) ? prompt.default : undefined,
  };
}

async function read(rootPath?: string): Promise<ReviewDiffrConfig> {
  const config = await values(rootPath);
  const defaults = await configDefaults(rootPath);
  const saved = valueAt(config, `${prefix}.api_key`);

  const credentialSource =
    isStringValue(saved) && saved.length > 0
      ? "config"
      : environmentKey(defaults.providers ?? [], savedProvider(config))
        ? "environment"
        : "missing";

  const plugins = valueAt(config, "plugins.shape");

  if (isJsonObject(plugins)) {
    const entries = isJsonObject(plugins.bundled)
      ? [...Object.values(plugins), ...Object.values(plugins.bundled)]
      : Object.values(plugins);

    for (const plugin of entries)
      if (isJsonObject(plugin)) delete plugin.api_key;
  }

  return { values: config, credentialSource, ...defaults };
}

export function readDiffrConfig(rootPath?: string): Promise<ReviewDiffrConfig> {
  return serialized(() => read(rootPath));
}

export async function migrateDiffrConfig(
  signal?: AbortSignal,
): Promise<boolean> {
  const result = json(
    await diffr({ command: "migrate" }, undefined, { signal }),
  );

  if (result.changed === true) invalidateStructuralComparisons();

  return result.changed === true;
}

async function writeSettings(
  patch: JsonObject,
  rootPath?: string,
): Promise<ReviewDiffrConfig> {
  let changed = false;
  let error: string | undefined;

  try {
    const result = json(await diffr({ command: "set", patch }, rootPath));
    changed = result.changed === true;

    if (changed) invalidateStructuralComparisons();
  } catch (cause) {
    error =
      cause instanceof Error
        ? cause.message
        : "diffr could not save the settings.";
  }

  return { ...(await read(rootPath)), changed, error };
}

export function setDiffrConfigValue(
  key: string,
  value: JsonValue,
  rootPath?: string,
): Promise<ReviewDiffrConfig> {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_-]*(\.[^.\r\n\0]+)*$/u.test(key)) {
    throw new Error("Invalid diffr config key.");
  }

  const parts = key.split(".");
  let patch: JsonObject = { [parts.pop()!]: value };

  for (const part of parts.reverse()) patch = { [part]: patch };

  return serialized(() => writeSettings(patch, rootPath));
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

    const summarize: JsonObject = {
      enabled: draft.enabled,
      provider: draft.provider,
      endpoint: draft.endpoint,
      model: draft.model,
      tests: draft.tests,
    };

    if (draft.apiKey) summarize.api_key = draft.apiKey;
    else if (moving && savedKey) summarize.api_key = "";

    if (draft.systemPrompt.trim()) summarize.system_prompt = draft.systemPrompt;

    return writeSettings(
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr config key.
      { plugins: { shape: { bundled: { summarize } } } },
      rootPath,
    );
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
    const providers = (await configDefaults(rootPath)).providers ?? [];

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
        version: 2,
        plugins: {
          // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr v2 config key.
          shape: {
            order: ["bundled.summarize"],
            bundled: { summarize: options },
          },
        },
      }),
      { mode: 0o600 },
    );

    const before = join(directory, "before.rs"),
      after = join(directory, "after.rs");

    await writeFile(before, "");
    await writeFile(after, SUMMARY_SAMPLE);

    const output = await diffr({ command: "diff", before, after }, directory, {
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
    });

    try {
      const events = output.trim().split("\n").map(decodeStructuralDiffEvent);
      const complete = events.at(-1);

      const labels = (region: StructuralRegion): string[] => [
        ...(region.visibility?.label ? [region.visibility.label] : []),
        ...(region.kind === "fold" ? region.children.flatMap(labels) : []),
      ];

      const summary = events
        .flatMap((event) =>
          event.type === "file" && event.diff?.type === "text"
            ? [event.diff.rhs, event.diff.lhs].flatMap((source) =>
                source ? labels(source.root) : [],
              )
            : [],
        )
        .find((label) => label.trim());

      if (
        complete?.type === "complete" &&
        complete.failed === 0 &&
        !complete.aborted &&
        !events.some((event) => event.type === "file" && event.error) &&
        summary
      ) {
        return apiKey ? summary.split(apiKey).join("[redacted]") : summary;
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
