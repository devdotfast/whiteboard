import { build } from "esbuild";

await build({ entryPoints: ["src/index.ts"], outdir: "dist", bundle: true, platform: "node", format: "esm",
  external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"] });
