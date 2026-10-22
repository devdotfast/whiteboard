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
    alias: canvasAliases,
  },
  base: "./",
  build: {
    assetsInlineLimit: 0,
    copyPublicDir: false,
    emptyOutDir: true,
    outDir: path.resolve(__dirname, "../../canvas/dist"),
    rollupOptions: {
      preserveEntrySignatures: "strict",
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
