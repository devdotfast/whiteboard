# Canvas authoring

Read `README.md` here and "UI controls" in `apps/review-desktop/README.md` first.

- Look for an existing piece before writing one: `ui/`, `icons.tsx`,
  `format.ts`, `option-menu.tsx`, `use-anchored-popover.ts`, `notify.ts`.
  Extend it with a variant rather than forking a local copy. In-page popovers
  use `useAnchoredPopover` with `surfaceStyles.popover` and `menuStyles.popover`.
- Menus, confirmations, notifications and tooltips go through the host. Reach
  them through `session.bridge` in a review, or `CanvasUiContext` on Home and
  onboarding, which have no session. Keep an in-page version only as the
  browser fallback.
- New host capabilities go in `packages/review-protocol/src/contracts.ts`, then
  `pnpm run protocol:sync` in `apps/review-desktop` (the fork copy is
  generated and gitignored).
- StyleX only: `tokens.*`, the steps in `scale.stylex.ts`, no screen-only
  tokens or steps, no new rules in `global.css`.
- Keep `stylex.create` values static: no spreads or helper calls.
- Check UI changes in an isolated Desktop launched with
  `DEV_FAST_REVIEW_DESKTOP_BACKGROUND=1`. Browser tests don't load workbench CSS
  or host services.
- Run `pnpm lint` and `pnpm format` from the repo root.
