import { defineConfig } from "tsdown";

// Inline only the private @dev.fast/json; consumers share zod and the Markdown parser.
export default defineConfig({
  entry: { index: "src/index.ts" },
  platform: "browser",
  format: "esm",
  outDir: "dist",
  fixedExtension: false,
  dts: true,
  deps: { alwaysBundle: [/^@dev\.fast\/json$/] },
});
