import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "tsdown";
import { afterAll, beforeAll, describe, test } from "vitest";

import {
  cleanupTempDirs,
  gitRepository,
  tempDir,
} from "../src/review-test-utils.ts";

let structuralDiff,
  readDiffrConfig,
  setDiffrConfigValue,
  saveDiffrSummarizer,
  testDiffrSummarizer,
  migrateDiffrConfig;

const diffrPackage = path.dirname(
  createRequire(import.meta.url).resolve("@dev.fast/diffr/package.json"),
);

const platformPackage = path.dirname(
  createRequire(path.join(diffrPackage, "package.json")).resolve(
    `@dev.fast/diffr-${process.platform}-${process.arch}/package.json`,
  ),
);

async function stageDiffr(runtime) {
  for (const [name, directory] of [
    ["diffr", diffrPackage],
    [`diffr-${process.platform}-${process.arch}`, platformPackage],
  ])
    await cp(
      directory,
      path.join(runtime, "node_modules/@dev.fast", name),
      { recursive: true, dereference: true },
    );
}

async function collect(repositoryPath, base, head, paths, kind = "trees") {
  return Array.fromAsync(
    structuralDiff({
      repositoryPath,
      comparison: { kind, base, head },
      paths,
      signal: AbortSignal.timeout(15_000),
    }),
  );
}

function successfulFiles(events, count) {
  assert.equal(events[0].type, "start");
  assert.equal(events[0].version, 3);
  assert.deepEqual(events.at(-1), {
    type: "complete",
    succeeded: count,
    failed: 0,
  });
  const files = events.filter((event) => event.type === "file");
  assert.equal(files.length, count);

  for (const file of files) {
    assert.equal(file.error, undefined);
    assert.ok(file.diff);
  }

  return files;
}

describe("Relocated runtime diffr integrates with Review streams and settings", () => {
  let root, repository, runtime, trap, sentinel, base, head;
  const savedEnv = { ...process.env };
  afterAll(async () => {
    process.env = savedEnv;
    await cleanupTempDirs();
  });
  beforeAll(async () => {
    root = await tempDir("review-bundled-diffr-");
    repository = await gitRepository();
    runtime = path.join(root, "runtime with spaces");
    trap = path.join(root, "trap");
    sentinel = path.join(root, "host-used");
    await mkdir(trap);
    process.env.XDG_CONFIG_HOME = path.join(root, "config");
    process.env.GIT_CONFIG_GLOBAL = path.join(root, "gitconfig");
    process.env.GIT_CONFIG_NOSYSTEM = "1";

    const git = (...args) =>
      execFileSync("git", ["-C", repository, ...args], {
        encoding: "utf8",
      }).trim();

    await writeFile(
      path.join(repository, "modified.ts"),
      "export function answer() { return 1; }\n",
    );
    await writeFile(
      path.join(repository, "deleted.ts"),
      "export const obsolete = true;\n",
    );
    git("add", ".");
    git("commit", "-qm", "base");
    base = git("rev-parse", "HEAD");
    await writeFile(
      path.join(repository, "modified.ts"),
      "export function answer() { return 42; }\n",
    );
    await writeFile(
      path.join(repository, "space name.ts"),
      "export const greeting = 'hello';\n",
    );
    await rm(path.join(repository, "deleted.ts"));
    git("add", "-A");
    git("commit", "-qm", "head");
    head = git("rev-parse", "HEAD");
    await stageDiffr(runtime);
    await build({
      config: false,
      entry: {
        "structural-diff": path.resolve(
          import.meta.dirname,
          "../src/server/structural-diff.ts",
        ),
        "diffr-config": path.resolve(
          import.meta.dirname,
          "../src/server/diffr-config.ts",
        ),
      },
      outDir: path.join(runtime, "dist"),
      platform: "node",
      format: "esm",
      dts: false,
      deps: { alwaysBundle: [/^@dev\.fast\//] },
    });

    const load = (name) =>
      import(
        /* @vite-ignore */ pathToFileURL(
          path.join(runtime, "dist", `${name}.mjs`),
        ).href
      );

    ({ structuralDiff } = await load("structural-diff"));
    ({
      migrateDiffrConfig,
      readDiffrConfig,
      setDiffrConfigValue,
      saveDiffrSummarizer,
      testDiffrSummarizer,
    } = await load("diffr-config"));
    await writeFile(
      path.join(trap, "diffr"),
      `#!/bin/sh\ntouch '${sentinel}'\nexit 97\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${trap}${path.delimiter}${savedEnv.PATH}`;
    process.env.REVIEW_DIFFR_BINARY = path.join(trap, "diffr");
  });

  test("bundled binary streams files and ignores host overrides", async () => {
    const events = await collect(repository, base, head);
    const files = successfulFiles(events, 3);
    assert.deepEqual(events[0].files.map(({ status }) => status).sort(), [
      "added",
      "deleted",
      "modified",
    ]);

    const added = files.find(({ file }) => file.rhs?.path === "space name.ts");

    const deleted = files.find(({ file }) => file.lhs?.path === "deleted.ts");

    const modified = files.find(({ file }) => file.rhs?.path === "modified.ts");

    assert.equal(modified.diff.type, "text");
    assert.match(modified.diff.lhs.text, /return 1;/);
    assert.match(modified.diff.rhs.text, /return 42;/);
    assert.ok(modified.diff.structural_changes.base.length);
    assert.ok(modified.diff.structural_changes.head.length);
    assert.equal(added.file.lhs, undefined);
    assert.equal(deleted.file.rhs, undefined);
    assert.equal(existsSync(sentinel), false);
  });

  test("merge-base comparison filters a path containing spaces", async () => {
    const events = await collect(
      repository,
      base,
      head,
      ["space name.ts"],
      "merge-base",
    );

    const [file] = successfulFiles(events, 1);
    assert.equal(file.file.rhs.path, "space name.ts");
  });

  test("identical revisions produce a complete empty stream", async () => {
    const events = await collect(repository, head, head);
    successfulFiles(events, 0);
    assert.deepEqual(events[0].files, []);
  });

  test("a saved UI config migrates through the staged binary with its overrides intact", async () => {
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = path.join(root, "migration");
    const directory = path.join(process.env.XDG_CONFIG_HOME, "diffr");
    await mkdir(directory, { recursive: true });

    const original = await readFile(
      new URL(
        "../src/server/test-fixtures/diffr-ui-overrides.toml",
        import.meta.url,
      ),
      "utf8",
    );

    await writeFile(path.join(directory, "config.toml"), original, {
      mode: 0o600,
    });

    try {
      assert.equal(await migrateDiffrConfig(), true);
      const config = await readDiffrConfig(repository);
      assert.equal(config.values.version, 2);
      assert.deepEqual(config.values.plugins.classify.bundled.hide, [
        "test",
        "generated",
      ]);
      assert.equal(config.values.plugins.classify.bundled.hide_deleted, false);
      assert.equal(config.values.plugins.shape.bundled.context.lines, 17);
      assert.equal(
        config.values.plugins.shape.bundled.summarize.system_prompt,
        "  Use my exact custom instructions.\nKeep # inside the prompt, and answer with JSON if I ask for it.\n",
      );

      const migrated = await readFile(
        path.join(directory, "config.toml"),
        "utf8",
      );

      assert.equal(await migrateDiffrConfig(), false);
      await readDiffrConfig(repository);
      assert.equal(
        await readFile(path.join(directory, "config.toml"), "utf8"),
        migrated,
      );
    } finally {
      process.env.XDG_CONFIG_HOME = previous;
    }
  });

  test("settings values and edits round-trip through the staged binary", async () => {
    const config = await readDiffrConfig(repository);
    assert.ok(
      Number.isInteger(config.values.plugins.shape.bundled.context.lines),
    );
    assert.equal(
      config.values.plugins.shape.bundled.summarize.api_key,
      undefined,
    );
    assert.ok(
      ["config", "environment", "missing"].includes(config.credentialSource),
    );

    const updated = await setDiffrConfigValue(
      "plugins.shape.bundled.context.lines",
      7,
      repository,
    );

    assert.equal(updated.values.plugins.shape.bundled.context.lines, 7);
    assert.equal(updated.changed, true);
    assert.equal(updated.error, undefined);
    assert.equal(
      (await readDiffrConfig(repository)).values.plugins.shape.bundled.context
        .lines,
      7,
    );
    assert.equal(existsSync(sentinel), false);
  });

  test("a provider switch saves through the binary and clears the old key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await setDiffrConfigValue(
      "plugins.shape.bundled.summarize.api_key",
      "old-secret",
      repository,
    );
    const current = await readDiffrConfig(repository);
    assert.ok(current.defaultPrompt);

    const saved = await saveDiffrSummarizer(
      {
        enabled: false,
        provider: "anthropic",
        model: "claude-haiku-4-5",
        endpoint: "",
        systemPrompt: current.defaultPrompt,
        tests: true,
        apiKey: "",
      },
      repository,
    );

    assert.equal(saved.error, undefined);
    assert.equal(
      saved.values.plugins.shape.bundled.summarize.provider,
      "anthropic",
    );
    assert.equal(saved.credentialSource, "missing");
  });

  test("setup summarizes through a keyless OpenAI-compatible server", async () => {
    delete process.env.OPENAI_API_KEY;
    let received;

    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        received = {
          url: request.url,
          authorization: request.headers.authorization,
          body: JSON.parse(body),
        };

        const content = "count and average positive values";

        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const summary = await testDiffrSummarizer(
        {
          enabled: true,
          provider: "openai",
          model: "local-model",
          endpoint: `http://127.0.0.1:${server.address().port}/v1`,
          systemPrompt: "Be terse.",
          tests: true,
          apiKey: "",
        },
        repository,
      );

      assert.equal(summary, "count and average positive values");
      assert.equal(received.url, "/v1/chat/completions");
      assert.equal(received.authorization, undefined);
      assert.equal(received.body.model, "local-model");
      assert.equal(received.body.messages[0].content, "Be terse.");
    } finally {
      server.close();
    }
  });
  test("a missing bundle fails without using PATH", async () => {
    await rm(path.join(runtime, "node_modules"), {
      recursive: true,
      force: true,
    });
    await assert.rejects(
      collect(repository, base, head),
      /The bundled diffr executable is missing/,
    );
    await assert.rejects(
      readDiffrConfig(repository),
      /The bundled diffr executable is missing/,
    );
    assert.equal(existsSync(sentinel), false);
  });
});
