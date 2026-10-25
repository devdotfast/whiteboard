import { defineConfig } from "vitest/config";

// Imports the built dist under Node, as a server render does.
export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
