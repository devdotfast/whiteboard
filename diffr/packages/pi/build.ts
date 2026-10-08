const result = await Bun.build({ entrypoints: ["src/index.ts"], outdir: "dist", target: "node", format: "esm",
  external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"] });
if (!result.success) throw new AggregateError(result.logs, "Pi extension build failed");
export {};
