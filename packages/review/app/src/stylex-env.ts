// Compile-time constants StyleX inlines as `stylex.env.*`. Conditions can't be
// defineConsts: as keys, the rules lose their condition.
export const stylexEnv = {
  reducedMotion: "@media (prefers-reduced-motion: reduce)",
  narrow: "@media (max-width: 720px)",
  prefersLight: "@media (prefers-color-scheme: light)",
  tocRailHidden: "@container review-content (max-width: 720px)",
} as const;

declare module "@stylexjs/stylex/lib/types/StyleXTypes" {
  interface Register {
    env: typeof stylexEnv;
  }
}
