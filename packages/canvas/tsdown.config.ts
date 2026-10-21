import { defineConfig } from "tsdown";

// Types only; vite.config.ts builds the JavaScript and the stylesheet.
export default defineConfig({
  entry: { index: "src/types.ts" },
  platform: "browser",
  format: "esm",
  outDir: "dist",
  clean: false,
  fixedExtension: false,
  dts: { emitDtsOnly: true },
});
