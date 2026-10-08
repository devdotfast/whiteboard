import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { type Plugin, defineConfig } from "vite";

// The editor is Review Desktop's fork of VS Code's, built from its sources.
const vs = fileURLToPath(
  new URL("../review-desktop/code-oss/src/vs", import.meta.url),
);

// Review Desktop's build copies the icon font into its sources; the page takes it from the package.
const codicons = join(
  dirname(
    createRequire(import.meta.url).resolve("@vscode/codicons/package.json"),
  ),
  "dist/codicon.ttf",
);

const engine = fileURLToPath(
  new URL("src/wasm/diffr_web_bg.wasm", import.meta.url),
);

/**
 * The engine is over 100 MB and Workers static assets cap a file at 25 MiB, so the page loads a
 * gzipped copy and unpacks it as it compiles. Written beside the engine whenever it is newer.
 */
function gzipEngine(): Plugin {
  const write = () => {
    if (!existsSync(engine)) return;
    const gz = `${engine}.gz`;

    if (existsSync(gz) && statSync(gz).mtimeMs >= statSync(engine).mtimeMs)
      return;
    writeFileSync(gz, gzipSync(readFileSync(engine), { level: 9 }));
  };

  return { name: "gzip-engine", buildStart: write, configureServer: write };
}

/**
 * wasm-bindgen's loader names the raw engine as its default source, which would ship it too; the
 * page always hands workers the compiled module instead, so the raw file is never fetched.
 */
function dropRawEngine(): Plugin {
  return {
    name: "drop-raw-engine",
    apply: "build",
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle))
        if (/diffr_web_bg-[\w-]+\.wasm$/.test(name)) delete bundle[name];
    },
  };
}

export default defineConfig({
  plugins: [gzipEngine(), dropRawEngine(), {
    name: "production-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: readFileSync(new URL("public/_headers", import.meta.url), "utf8"),
      });
    },
  }],
  resolve: {
    alias: [
      { find: /^vs\//, replacement: `${vs}/` },
      { find: /^\.\/codicon\.ttf$/, replacement: codicons },
    ],
  },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  worker: { format: "es", plugins: () => [dropRawEngine()] },
  // Keep local UI fixtures available in dev without publishing them.
  build: { target: "es2024", chunkSizeWarningLimit: 4096, copyPublicDir: false },
});
