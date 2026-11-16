import { defineConfig } from "vite";

import { canvasAliases, canvasPlugins } from "../review/app/canvas-vite";

// The canvas's own plugins and aliases, so the lab can render canvas
// components such as the code peek straight from their source.
export default defineConfig({
  plugins: canvasPlugins(),
  resolve: { alias: canvasAliases },
  server: { open: false },
});
