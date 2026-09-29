import { afterEach, beforeAll } from "vitest";

// SAFETY: React exposes this documented test-environment flag without adding
// it to TypeScript's global declarations.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
});

// Vitest has no CSS asset for StyleX to append its rules to. Load them from
// the plugin's dev endpoint once per file, after its imports are transformed,
// last in <head>, where the production build puts them. Reloading before every
// test restyles the page each time and starves later tests of frames.
beforeAll(async () => {
  const stale = document.querySelectorAll("link[data-stylex-dev]");
  const link = document.createElement("link");

  link.rel = "stylesheet";
  link.href = `/virtual:stylex.css?t=${performance.now()}`;
  link.dataset.stylexDev = "";

  await new Promise((resolve, reject) => {
    link.onload = resolve;
    link.onerror = reject;
    document.head.append(link);
  });

  for (const old of stale) old.remove();
});
