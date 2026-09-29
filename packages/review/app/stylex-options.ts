import type { UserOptions } from "@stylexjs/unplugin";

// One option set for the production build and Vitest, so a style hashes to the
// same class name in both. `dev: false` also keeps StyleX from adding debug
// class names and `data-style-src` attributes.
export const stylexOptions = {
  dev: false,
  // Unsupported properties (the `background` and `border` shorthands) are
  // otherwise dropped without a word.
  propertyValidationMode: "throw",
  unstable_moduleResolution: { type: "commonJS", rootDir: __dirname },
  // Chromium 140 (Electron 42) is the runtime floor: nothing to lower.
  lightningcssOptions: { targets: { chrome: 140 << 16 }, minify: true },
} satisfies Partial<UserOptions>;
