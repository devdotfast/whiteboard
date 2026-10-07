import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { openLocalReviewStore } from "@review/review-api/local-data.js";
import { parse } from "smol-toml";
import { afterEach, expect, test, vi } from "vitest";

import { createGlobalReviewServer } from "./desktop-server.js";
import { runHeadlessServer } from "./headless-host.js";

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test.each(["desktop", "headless"] as const)(
  "%s startup keeps invalid config, migrates before ready, and does not rewrite on restart",
  async (host) => {
    const root = await mkdtemp(path.join(tmpdir(), "review-diffr-startup-"));
    roots.push(root);
    vi.stubEnv("DEV_REVIEW_HOME", root);
    vi.stubEnv("XDG_CONFIG_HOME", root);
    vi.stubEnv("DEV_FAST_REVIEW_TELEMETRY_DISABLED", "1");
    const file = path.join(root, "diffr", "config.toml");
    await mkdir(path.dirname(file));

    const original =
      "version = 1\n[plugins.bundled.context]\nlines = 17\nenabled = false\n";

    const ready = async () => {
      expect(parse(await readFile(file, "utf8"))).toMatchObject({
        version: 2,
        plugins: {
          // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Native diffr v2 config key.
          shape: { bundled: { context: { lines: 17, enabled: false } } },
        },
      });
    };

    const start = async () => {
      let configAtReady: string | undefined;

      if (host === "headless") {
        const controller = new AbortController();

        const running = runHeadlessServer({
          stateDir: path.join(root, "server"),
          signal: controller.signal,
          onReady: () => {
            configAtReady = readFileSync(file, "utf8");
            controller.abort();
          },
        });

        await running;
        await ready();
      } else {
        const local = openLocalReviewStore(path.join(root, "reviews.db"));

        const server = createGlobalReviewServer({
          reviewStore: local.store,
          reviewData: local.data,
          appPid: process.pid,
          packageRoot: root,
          toolingRoot: root,
          port: 0,
        });

        try {
          await server.listen();
          configAtReady = readFileSync(file, "utf8");
          await ready();
        } finally {
          await server.close();
          await local.data.close();
          await local.store.close();
        }
      }

      expect(parse(configAtReady!)).toMatchObject({ version: 2 });
    };

    const invalid = "[invalid TOML";
    await writeFile(file, invalid);
    await expect(start()).rejects.toThrow(/TOML/);
    expect(await readFile(file, "utf8")).toBe(invalid);

    await writeFile(file, original);
    await start();
    const migrated = await readFile(file, "utf8");
    await start();
    expect(await readFile(file, "utf8")).toBe(migrated);
  },
);
