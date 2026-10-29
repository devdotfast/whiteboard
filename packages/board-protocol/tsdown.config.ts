import { defineConfig } from "tsdown";

// Dependencies, @dev.fast/whiteboard-document included, stay external.
export default defineConfig({
  entry: { index: "src/index.ts" },
  platform: "neutral",
  format: "esm",
  outDir: "dist",
  fixedExtension: false,
  dts: true,
});
