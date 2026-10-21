import path from "node:path";

import { defineConfig, esmExternalRequirePlugin } from "vite";

import { canvasPlugins, canvasResolve } from "../review/app/canvas-vite";

// Not library mode: it inlines every font as `data:`, which a strict CSP
// refuses. An app build with a strict entry keeps the exports and the files.
export default defineConfig({
  root: __dirname,
  plugins: [
    ...canvasPlugins(),
    // The page brings React. CommonJS dependencies (use-sync-external-store,
    // under @xyflow/react) require it; this turns those into imports.
    esmExternalRequirePlugin({ external: [/^react(-dom)?(\/|$)/] }),
    {
      // One stylesheet, at the path the package exports, beside its fonts. Named at the end:
      // StyleX's own pass emits an interim one under the same name.
      name: "canvas-css-name",
      enforce: "post",
      generateBundle(_options, bundle) {
        const css = Object.values(bundle).filter(
          (output) =>
            output.type === "asset" && output.fileName.endsWith(".css"),
        );

        if (css.length !== 1)
          this.error(`Expected one stylesheet, got ${css.length}.`);
        const [stylesheet] = css;

        if (stylesheet?.type !== "asset") return;
        delete bundle[stylesheet.fileName];
        this.emitFile({
          type: "asset",
          fileName: "assets/canvas.css",
          source: stylesheet.source,
        });
      },
    },
  ],
  resolve: canvasResolve,
  // The stylesheet finds its fonts beside it, wherever the page serves it.
  base: "./",
  build: {
    assetsInlineLimit: 0,
    copyPublicDir: false,
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      input: { index: path.join(__dirname, "src/index.ts") },
      preserveEntrySignatures: "strict",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
        // libavoid.wasm keeps its name for the export; fonts stay hashed,
        // beside the stylesheet that names them.
        assetFileNames: (asset) =>
          asset.names.includes("libavoid.wasm")
            ? "[name][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
