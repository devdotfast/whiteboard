import { defineConfig } from "tsdown";

// Types only: the canvas must not enter the types build.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  outDir: "dist",
  clean: false,
  fixedExtension: false,
  dts: { emitDtsOnly: true },
});
