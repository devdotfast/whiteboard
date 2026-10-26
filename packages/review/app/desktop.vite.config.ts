import path from "node:path";

import { defineConfig } from "vite";

import { canvasAliases, canvasPlugins } from "./canvas-vite";

export default defineConfig({
  root: __dirname,
  plugins: canvasPlugins(),
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: canvasAliases,
  },
  // Relative asset URLs: the stylesheet is loaded by `<link>` from the workbench
  // `out/vs/review/canvas/assets` directory, so `url(...)` references inside it
  // (the bundled Geist Mono / Newsreader faces) must resolve against the CSS
  // file, not the `vscode-file://vscode-app/` root.
  base: "./",
  build: {
    // The workbench CSP refuses `data:` fonts.
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
    copyPublicDir: false,
    // Electron 42. Lowering light-dark() would resolve the palette on the root.
    cssTarget: "chrome140",
    emptyOutDir: true,
    manifest: true,
    outDir: "dist/desktop",
    rollupOptions: {
      // Shared modules stay in the entry and its one stylesheet.
      preserveEntrySignatures: "allow-extension",
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
