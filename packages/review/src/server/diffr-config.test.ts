import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as diffr from "@dev.fast/diffr";
import type { JsonObject } from "@dev.fast/json";
import { parse, stringify } from "smol-toml";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  readDiffrConfig,
  saveDiffrSummarizer,
  setDiffrConfigValue,
  testDiffrSummarizer,
} from "./diffr-config";
import { StructuralComparisons } from "./structural-comparisons";

const roots: string[] = [];

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GOOGLE_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const DEFAULT_PROMPT = "Summarize each fold.";

const draft = {
  enabled: true,
  provider: "gemini" as const,
  model: "test-model",
  endpoint: "",
  systemPrompt: DEFAULT_PROMPT,
  tests: true,
};

async function diffrTestProcess(
  key = "",
  summarize: JsonObject = {},
  classifier?: JsonObject,
) {
  const root = await mkdtemp(path.join(tmpdir(), "review-diffr-config-"));
  roots.push(root);

  const log = path.join(root, "calls.jsonl"),
    state = path.join(root, "xdg", "diffr", "config.toml"),
    file = path.join(root, "diffr");

  const binary = diffr.diffrBinaryPath();
  await mkdir(path.dirname(state), { recursive: true });

  await writeFile(
    state,
    stringify({
      version: 2,
      plugins: {
        ...(classifier && { classify: { bundled: classifier } }),
        // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr v2 config key.
        shape: {
          bundled: {
            summarize: {
              enabled: false,
              provider: "gemini",
              model: "old",
              tests: false,
              system_prompt: DEFAULT_PROMPT,
              ...(key && { api_key: key }),
              ...summarize,
            },
            context: { lines: 3, enabled: true },
          },
        },
      },
    }),
  );
  await writeFile(
    file,
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const log = ${JSON.stringify(log)};
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (args[0] === 'config') {
  if (args[1] === 'schema' && process.env.FAIL_SCHEMA) process.exit(2);
  if (args[1] === 'show' && process.env.TEST_VALUES) {
    console.log(fs.readFileSync(process.env.TEST_VALUES, 'utf8'));
    process.exit(0);
  }
  if (args[1] === 'set' && process.env.FAIL_SET) {
    console.error(fs.readFileSync(0, 'utf8'));
    console.log(JSON.stringify({error:{message:'diffr rejected the change'}}));
    process.exit(2);
  }
  const result = require('node:child_process').spawnSync(${JSON.stringify(binary)}, args, {stdio:'inherit'});
  process.exit(result.status ?? 1);
 } else if (!args.includes('--no-index')) {
  console.log(JSON.stringify({type:'start',version:3,lhs:{type:'revision',rev:'base'},rhs:{type:'revision',rev:'head'},files:[]}));
  console.log(JSON.stringify({type:'complete',succeeded:0,failed:0}));
} else {
  const temporary = require('node:path').join(process.env.XDG_CONFIG_HOME, 'diffr', 'config.toml');
  fs.writeFileSync(${JSON.stringify(path.join(root, "test-config"))}, fs.readFileSync(temporary));
  fs.writeFileSync(${JSON.stringify(path.join(root, "test-path"))}, temporary);
  const mode = process.env.TEST_MODE;
  fs.writeFileSync(${JSON.stringify(path.join(root, "test-env"))}, JSON.stringify({ gemini: process.env.GEMINI_API_KEY, openai: process.env.OPENAI_API_KEY }));
  if (mode === 'reject') { console.error(process.env.GEMINI_API_KEY); process.exit(2); }
  if (mode === 'hang') { setTimeout(() => {}, 10000); }
  else {
    const file = {rhs:{path:'after.rs',oid:'',mode:''}};
    console.log(JSON.stringify({type:'file',file,diff:{type:'text',rhs:{text:'sample',root:{kind:'leaf',id:1,fold_state_id:1,alignment_id:1,start:{line:0,column:0},end:{line:0,column:6},visibility:mode === 'empty' ? undefined : {collapsed:true,label:'count positive values'}}},structural_changes:{base:[],head:[[0,1]]},stats:{textual:{added:1,removed:0},visible:{added:0,removed:0}}}}));
    console.log(JSON.stringify({type:'complete',succeeded:1,failed:0}));
  }
}
`,
    { mode: 0o755 },
  );
  vi.spyOn(diffr, "diffrBinaryPath").mockReturnValue(file);

  vi.stubEnv("XDG_CONFIG_HOME", path.join(root, "xdg"));

  return {
    root,
    state,
    calls: async () =>
      (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
  };
}

async function savedConfig(file: string) {
  return parse(await readFile(file, "utf8")) as {
    plugins: {
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr config key.
      shape: { bundled: Record<string, JsonObject> };
      classify: { bundled: JsonObject };
    };
  };
}

test("reads resolved values and reports credentials without exposing keys", async () => {
  await diffrTestProcess("saved-secret");
  vi.stubEnv("GEMINI_API_KEY", "env-secret");
  const config = await readDiffrConfig();
  expect(config.credentialSource).toBe("config");
  expect(JSON.stringify(config)).not.toMatch(
    /saved-secret|env-secret|redacted|api_key/,
  );
});

test("redacts credentials in bundled and nested plugin values", async () => {
  const fixture = await diffrTestProcess("bundled-secret");
  const values = path.join(fixture.root, "values.json");
  await writeFile(
    values,
    JSON.stringify({
      plugins: {
        // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr config key.
        shape: {
          bundled: { summarize: { api_key: "bundled-secret" } },
          custom: { api_key: "custom-secret", enabled: true },
        },
      },
    }),
  );
  vi.stubEnv("TEST_VALUES", values);

  const config = await readDiffrConfig();
  expect(JSON.stringify(config)).not.toMatch(
    /bundled-secret|custom-secret|api_key/,
  );
  expect(config.values).toMatchObject({
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr config key.
    plugins: { shape: { custom: { enabled: true } } },
  });
});

test("detects host environment credentials and missing credentials", async () => {
  await diffrTestProcess();
  expect((await readDiffrConfig()).credentialSource).toBe("missing");
  vi.stubEnv("GOOGLE_API_KEY", "environment-secret");
  expect((await readDiffrConfig()).credentialSource).toBe("environment");
});

test("reads classifier values and schema defaults without old plugin keys", async () => {
  await diffrTestProcess(
    "saved-secret",
    {},
    { hide: ["test", "custom"], hide_deleted: false },
  );
  const config = await readDiffrConfig();
  expect(config.values).toMatchObject({
    plugins: {
      classify: { bundled: { hide: ["test", "custom"], hide_deleted: false } },
    },
  });
  expect(config.defaultHiddenTags).toEqual(["generated", "vendored"]);
  expect(JSON.stringify(config)).not.toContain("saved-secret");
});

test("writes classifier values without changing credentials", async () => {
  const fake = await diffrTestProcess(
    "saved-secret",
    {},
    { hide: ["custom"], hide_deleted: true },
  );

  expect(
    (await setDiffrConfigValue("plugins.classify.bundled.hide", ["custom"]))
      .changed,
  ).toBe(false);
  await setDiffrConfigValue("plugins.classify.bundled.hide", []);
  await setDiffrConfigValue("plugins.classify.bundled.hide_deleted", false);
  const disabled = await savedConfig(fake.state);
  expect(disabled.plugins.classify.bundled).toEqual({
    hide: [],
    hide_deleted: false,
  });
  await setDiffrConfigValue("plugins.classify.bundled.hide", ["custom"]);
  const enabled = await savedConfig(fake.state);
  expect(enabled.plugins.classify.bundled).toEqual({
    hide: ["custom"],
    hide_deleted: false,
  });
  expect(enabled.plugins.shape.bundled.summarize.api_key).toBe("saved-secret");
  expect(enabled.plugins.shape.bundled["hide-files"]).toBeUndefined();
});

test("writes a setting, rereads it, and avoids invalidation for a no-op", async () => {
  await diffrTestProcess();
  expect(
    (await setDiffrConfigValue("plugins.shape.bundled.context.lines", 3))
      .changed,
  ).toBe(false);

  const result = await setDiffrConfigValue(
    "plugins.shape.bundled.context.lines",
    8,
  );

  expect(result).toMatchObject({
    changed: true,
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr v2 config key.
    values: { plugins: { shape: { bundled: { context: { lines: 8 } } } } },
  });
});

test("saves credentials and options together and preserves blank keys", async () => {
  const fake = await diffrTestProcess();
  await saveDiffrSummarizer({ ...draft, apiKey: "test-secret" });
  await saveDiffrSummarizer({ ...draft, apiKey: "" });
  expect(
    (await savedConfig(fake.state)).plugins.shape.bundled.summarize.api_key,
  ).toBe("test-secret");
});

test("serializes concurrent batch saves", async () => {
  const fake = await diffrTestProcess("test-secret");
  await saveDiffrSummarizer(draft);
  await Promise.all([
    saveDiffrSummarizer({ ...draft, enabled: false, model: "next" }),
    setDiffrConfigValue("plugins.shape.bundled.context.lines", 9),
  ]);

  expect((await savedConfig(fake.state)).plugins.shape.bundled).toMatchObject({
    summarize: { model: "next", api_key: "test-secret" },
    context: { lines: 9 },
  });
  expect((await readDiffrConfig()).values).toMatchObject({
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr config key.
    plugins: { shape: { bundled: { summarize: { enabled: false } } } },
  });
});

test("a rejected batch preserves current values without leaking the key", async () => {
  await diffrTestProcess();
  vi.stubEnv("FAIL_SET", "1");
  const result = await saveDiffrSummarizer({ ...draft, apiKey: "test-secret" });
  expect(result.changed).toBe(false);
  expect(result.error).toContain("diffr rejected the change");
  expect(result.values).toMatchObject({
    plugins: {
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr v2 config key.
      shape: { bundled: { summarize: { enabled: false, model: "old" } } },
    },
  });
  expect(JSON.stringify(result)).not.toContain("test-secret");
});

test("cannot enable summaries without credentials", async () => {
  await diffrTestProcess();
  expect(await saveDiffrSummarizer(draft)).toMatchObject({
    changed: false,
    error: expect.stringContaining("API key"),
  });
});

test("synthetic test returns a summary without saving and cleans its config", async () => {
  const fake = await diffrTestProcess("saved-secret");
  const before = await readFile(fake.state, "utf8");
  expect(await testDiffrSummarizer(draft)).toBe("count positive values");
  expect(await readFile(fake.state, "utf8")).toBe(before);
  expect(
    await readFile(path.join(fake.root, "test-config"), "utf8"),
  ).not.toContain("saved-secret");
  await expect(
    readFile(await readFile(path.join(fake.root, "test-path"), "utf8")),
  ).rejects.toThrow("ENOENT");
});

test("rejected credentials and empty summaries are safe failures with cleanup", async () => {
  const fake = await diffrTestProcess();
  vi.stubEnv("TEST_MODE", "reject");
  await expect(
    testDiffrSummarizer({ ...draft, apiKey: "test-secret" }),
  ).rejects.toThrow("Check its configuration and credentials");
  await expect(
    readFile(await readFile(path.join(fake.root, "test-path"), "utf8")),
  ).rejects.toThrow("ENOENT");
  vi.stubEnv("TEST_MODE", "empty");
  await expect(
    testDiffrSummarizer({ ...draft, apiKey: "test-secret" }),
  ).rejects.toThrow("No summary was produced");
});

test("a cancelled test cleans temporary files and releases the single-test guard", async () => {
  const fake = await diffrTestProcess("test-secret");
  vi.stubEnv("TEST_MODE", "hang");
  const controller = new AbortController();

  const cancelled = testDiffrSummarizer(
    draft,
    undefined,
    controller.signal,
  ).catch((error) => error);

  try {
    await expect
      .poll(
        () =>
          readFile(path.join(fake.root, "test-path"), "utf8").catch(() => ""),
        { timeout: 5_000 },
      )
      .not.toBe("");
  } finally {
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({
      message: expect.stringContaining("timed out or was cancelled"),
    });
  }

  await expect(
    readFile(await readFile(path.join(fake.root, "test-path"), "utf8")),
  ).rejects.toThrow("ENOENT");
  vi.stubEnv("TEST_MODE", "");
  expect(await testDiffrSummarizer(draft)).toBe("count positive values");
});

test("rejects malformed keys and reports missing executables", async () => {
  await expect(async () => setDiffrConfigValue("--flag", true)).rejects.toThrow(
    "Invalid diffr config key",
  );
  vi.spyOn(diffr, "diffrBinaryPath").mockReturnValue("/nonexistent/diffr");
  await expect(readDiffrConfig()).rejects.toThrow(
    "The bundled diffr executable is missing",
  );
});

test("saved changes invalidate cached comparisons while no-op saves reuse them", async () => {
  const fake = await diffrTestProcess();
  const cache = new StructuralComparisons();

  const input = {
    repositoryPath: fake.root,
    comparison: { kind: "trees" as const, base: "base", head: "head" },
    signal: new AbortController().signal,
  };

  async function consume() {
    for await (const event of cache.stream(input))
      expect(event.type).toMatch(/start|complete/);
  }

  try {
    await consume();
    await setDiffrConfigValue("plugins.shape.bundled.context.lines", 3);
    await consume();
    expect(
      (await fake.calls()).filter((args) => args[0] === "--repo"),
    ).toHaveLength(1);
    await setDiffrConfigValue("plugins.shape.bundled.context.lines", 8);
    await consume();
    expect(
      (await fake.calls()).filter((args) => args[0] === "--repo"),
    ).toHaveLength(2);
  } finally {
    cache.close();
  }
});

test("saves a changed prompt and leaves an unchanged one alone", async () => {
  const fake = await diffrTestProcess("test-secret");
  await saveDiffrSummarizer({ ...draft, enabled: false });
  expect(
    (await savedConfig(fake.state)).plugins.shape.bundled.summarize
      .system_prompt,
  ).toBe(DEFAULT_PROMPT);
  await saveDiffrSummarizer({
    ...draft,
    enabled: false,
    systemPrompt: "Be terse.",
  });
  expect(
    (await savedConfig(fake.state)).plugins.shape.bundled.summarize
      .system_prompt,
  ).toBe("Be terse.");
});

test("switching providers clears the saved key unless a new one is entered", async () => {
  const fake = await diffrTestProcess("gemini-secret");

  const state = async () =>
    (await savedConfig(fake.state)).plugins.shape.bundled.summarize;

  await saveDiffrSummarizer({
    ...draft,
    enabled: false,
    provider: "anthropic",
  });
  expect(await state()).toMatchObject({ provider: "anthropic", api_key: "" });
  await saveDiffrSummarizer({
    ...draft,
    enabled: false,
    provider: "openai",
    apiKey: "openai-secret",
  });
  expect(await state()).toMatchObject({
    provider: "openai",
    api_key: "openai-secret",
  });
});

test("credentials are checked against the draft provider", async () => {
  await diffrTestProcess("gemini-secret");
  expect(
    await saveDiffrSummarizer({ ...draft, provider: "anthropic" }),
  ).toMatchObject({
    changed: false,
    error: expect.stringContaining("API key"),
  });
  vi.stubEnv("ANTHROPIC_API_KEY", "env-secret");
  expect(
    (await saveDiffrSummarizer({ ...draft, provider: "anthropic" })).error,
  ).toBeUndefined();
  expect(
    (
      await saveDiffrSummarizer({
        ...draft,
        provider: "openai",
        endpoint: "http://127.0.0.1:11434/v1",
      })
    ).error,
  ).toBeUndefined();
});

test("the synthetic test never sends a saved key to another provider and uses the draft prompt", async () => {
  const fake = await diffrTestProcess("gemini-secret");
  await expect(
    testDiffrSummarizer({ ...draft, provider: "openai" }),
  ).rejects.toThrow("Add an API key");
  vi.stubEnv("OPENAI_API_KEY", "env-openai");
  expect(
    await testDiffrSummarizer({
      ...draft,
      provider: "openai",
      systemPrompt: "Draft prompt.",
    }),
  ).toBe("count positive values");
  expect(
    JSON.parse(await readFile(path.join(fake.root, "test-env"), "utf8")),
  ).toEqual({ gemini: "", openai: "env-openai" });
  const config = await readFile(path.join(fake.root, "test-config"), "utf8");
  expect(config).toContain('provider = "openai"');
  expect(config).toContain("Draft prompt.");
});

test("reads the environment key of the saved provider", async () => {
  await diffrTestProcess();
  await saveDiffrSummarizer({
    ...draft,
    enabled: false,
    provider: "anthropic",
  });
  vi.stubEnv("GEMINI_API_KEY", "gemini-env");
  expect((await readDiffrConfig()).credentialSource).toBe("missing");
  vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-env");
  expect((await readDiffrConfig()).credentialSource).toBe("environment");
});

test("a new endpoint is treated like a new provider", async () => {
  const fake = await diffrTestProcess("saved-secret");
  const moved = { ...draft, endpoint: "https://proxy.example/v1" };
  await expect(testDiffrSummarizer(moved)).rejects.toThrow("Add an API key");
  await saveDiffrSummarizer({ ...moved, enabled: false });
  expect(
    (await savedConfig(fake.state)).plugins.shape.bundled.summarize,
  ).toMatchObject({ api_key: "", endpoint: "https://proxy.example/v1" });
});

test("settings still read when diffr describes no schema", async () => {
  await diffrTestProcess();
  vi.stubEnv("FAIL_SCHEMA", "1");
  const config = await readDiffrConfig();
  expect(config.defaultPrompt).toBeUndefined();
  expect(config.values).toBeDefined();
});

test("a saved prompt is compared as written and a blank one is left alone", async () => {
  const fake = await diffrTestProcess("", { system_prompt: "Custom.\n" });
  await saveDiffrSummarizer({
    ...draft,
    enabled: false,
    systemPrompt: "Custom.\n",
  });
  await saveDiffrSummarizer({ ...draft, enabled: false, systemPrompt: "" });
  expect(
    (await savedConfig(fake.state)).plugins.shape.bundled.summarize
      .system_prompt,
  ).toBe("Custom.\n");
});
