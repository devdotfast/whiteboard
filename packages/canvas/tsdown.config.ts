import { defineConfig } from "tsdown";

// Declarations only, from the types-only entry: the canvas itself never
// enters the types build.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  outDir: "dist",
  clean: false,
  fixedExtension: false,
  dts: { emitDtsOnly: true },
});
