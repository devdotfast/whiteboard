import { createRequire } from "node:module";
import path from "node:path";

import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { sourceAliases } from "../test-config";
import { scopeReviewCanvasCss } from "./desktop-css-scope";
import {
  hardenLibavoidForTrustedTypes,
  isLibavoidBrowserModule,
} from "./desktop-trusted-types";
import { stylexOptions } from "./stylex-options";

const require = createRequire(import.meta.url);

const decodeNamedCharacterReferenceIndex = path.join(
  path.dirname(require.resolve("decode-named-character-reference")),
  "index.js",
);

export default defineConfig({
  root: __dirname,
  plugins: [
    // Appends the collected StyleX rules to the canvas CSS asset in its own
    // generateBundle, which runs before the scoping plugin below.
    stylex.vite(stylexOptions),
    {
      name: "harden-libavoid-trusted-types",
      enforce: "pre",
      transform(source, moduleId) {
        if (!isLibavoidBrowserModule(moduleId)) return;

        return {
          code: hardenLibavoidForTrustedTypes(source),
          map: null,
        };
      },
    },
    {
      // Chromium reads woff2, so KaTeX's woff and ttf fallbacks would ship
      // unused.
      name: "katex-woff2-only",
      enforce: "pre",
      transform(source, moduleId) {
        if (!/[/\\]katex[/\\]dist[/\\]katex\.css$/.test(moduleId)) return;

        return {
          code: source.replaceAll(
            /, url\([^)]+\) format\("(?:woff|truetype)"\)/g,
            "",
          ),
          map: null,
        };
      },
    },
    react(),
    {
      name: "scope-review-canvas-css",
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== "asset" || !output.fileName.endsWith(".css")) {
            continue;
          }

          const source =
            output.source instanceof Uint8Array
              ? new TextDecoder().decode(output.source)
              : output.source;

          output.source = scopeReviewCanvasCss(source);
        }
      },
    },
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      ...sourceAliases,
      "decode-named-character-reference": decodeNamedCharacterReferenceIndex,
    },
  },
  // Relative asset URLs: the stylesheet is loaded by `<link>` from the workbench
  // `out/vs/review/canvas/assets` directory, so `url(...)` references inside it
  // (the bundled Geist Mono / Newsreader faces) must resolve against the CSS
  // file, not the `vscode-file://vscode-app/` root.
  base: "./",
  build: {
    // The workbench CSP refuses `data:` fonts, so a small one stays a file.
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
    copyPublicDir: false,
    emptyOutDir: true,
    manifest: true,
    outDir: "dist/desktop",
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        canvas: path.resolve(__dirname, "src/desktop-entry.tsx"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
