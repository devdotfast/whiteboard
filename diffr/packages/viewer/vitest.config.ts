import { defineConfig } from "vitest/config";

// Bun and esbuild read `with { type: "text" }` imports; Vite needs this to load the themes.
export default defineConfig({
  plugins: [{ name: "toml-as-text", transform: (code, id) => (id.endsWith(".toml") ? `export default ${JSON.stringify(code)};` : undefined) }],
  test: { environment: "node" },
});
