import { createRequire, registerHooks } from "node:module";

const require = createRequire(import.meta.url);

const typescript = require.resolve("typescript");

// Volar imports TypeScript independently of @astrojs/check. In this hoisted
// workspace it otherwise finds native TS 7 at the root, which has no compiler
// API. Scope all compiler imports in this check process to the docs' TS 6.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "typescript" ? typescript : specifier,
      context,
    );
  },
});

try {
  const { check } = await import("@astrojs/check");

  process.exitCode = (await check({ root: process.cwd() })) ? 1 : 0;
} finally {
  hooks.deregister();
}
