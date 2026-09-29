import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

import { reviewTestAliases } from "../test-config";
import { stylexOptions } from "./stylex-options";

const require = createRequire(import.meta.url);

const alias = {
  ...reviewTestAliases,
  "decode-named-character-reference": path.join(
    path.dirname(require.resolve("decode-named-character-reference")),
    "index.js",
  ),
};

// browser-test-setup.ts loads the collected rules from the plugin's
// /virtual:stylex.css endpoint; `css-only` skips its HMR runtime. The plugin
// also starts an HMR poll that it never clears when Vitest closes the server,
// which holds the process open for Vitest's 10 s close timeout; unref it.
function stylexDevCss(): Plugin {
  const plugin: Plugin = stylex.vite({ ...stylexOptions, devMode: "css-only" });
  const hook = plugin.configureServer;

  return {
    ...plugin,
    configureServer(server) {
      const { setInterval } = globalThis;

      // SAFETY: the wrapper passes its arguments through and returns the same
      // timer, only unref'd.
      globalThis.setInterval = ((...args: Parameters<typeof setInterval>) =>
        setInterval(...args).unref()) as typeof setInterval;

      try {
        return (
          hook && ("handler" in hook ? hook.handler : hook).call(this, server)
        );
      } finally {
        globalThis.setInterval = setInterval;
      }
    },
  };
}

export default defineConfig({
  test: {
    env: {
      DEV_REVIEW_HOME: path.join(
        os.tmpdir(),
        `review-canvas-tests-${process.pid}`,
      ),
      GITHUB_REPOSITORY: "",
    },
    maxWorkers: 1,
    projects: [
      {
        plugins: [stylex.rollup(stylexOptions)],
        resolve: { alias },
        test: {
          name: "canvas-node",
          environment: "node",
          isolate: false,
          exclude: [
            ...configDefaults.exclude,
            "src/**/*.browser.test.{ts,tsx}",
          ],
          testTimeout: 15_000,
        },
      },
      {
        plugins: [stylexDevCss(), react()],
        resolve: { alias, dedupe: ["react", "react-dom"] },
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.{ts,tsx}"],
          isolate: process.env.CI === "true",
          setupFiles: ["src/browser-test-setup.ts"],
          testTimeout: 15_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
            viewport: { width: 1280, height: 900 },
            screenshotFailures: true,
            trace: process.env.CI === "true" ? "retain-on-failure" : "off",
          },
        },
      },
    ],
  },
});
