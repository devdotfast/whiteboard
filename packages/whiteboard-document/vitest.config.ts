import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@dev.fast/json": fileURLToPath(
        new URL("../json/src/index.ts", import.meta.url),
      ),
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
