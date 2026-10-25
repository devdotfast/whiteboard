import path from "node:path";

import { defineConfig } from "vite";

import { canvasAliases, canvasPlugins } from "./canvas-vite";

// React stays external; fonts and wasm ship as files.
export default defineConfig({
  root: __dirname,
  plugins: [
    ...canvasPlugins(),
    {
      // The package exports this path, so it takes no hash.
      name: "canvas-css-name",
      enforce: "post",
      generateBundle(_options, bundle) {
        for (const [key, output] of Object.entries(bundle)) {
          if (output.type !== "asset" || !key.endsWith(".css")) continue;
          delete bundle[key];
          this.emitFile({
            type: "asset",
            fileName: "assets/canvas.css",
            source: output.source,
          });
        }
      },
    },
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      ...Object.entries(canvasAliases).map(([find, replacement]) => ({
        find,
        replacement,
      })),
      // Its CommonJS shims require("react"), which an external React breaks.
      {
        find: /^use-sync-external-store\/shim(?:\/with-selector)?(?:\.js)?$/,
        replacement: path.resolve(__dirname, "use-sync-external-store.ts"),
      },
    ],
  },
  base: "./",
  build: {
    // Preload hints resolve against the consumer's page, not this package.
    modulePreload: false,
    assetsInlineLimit: 0,
    copyPublicDir: false,
    // light-dark(); lowering it would resolve the palette on the root.
    cssTarget: ["chrome123", "firefox120", "safari17.5"],
    emptyOutDir: true,
    outDir: path.resolve(__dirname, "../../canvas/dist"),
    rollupOptions: {
      // Shared modules stay in index.js instead of a second eager chunk.
      preserveEntrySignatures: "allow-extension",
      input: {
        canvas: path.resolve(__dirname, "src/canvas-entry.ts"),
      },
      external: [/^react(?:-dom)?(?:\/.*)?$/],
      output: {
        entryFileNames: "index.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
