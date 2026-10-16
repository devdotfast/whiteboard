IMPORTANT: ASK FOR PERMISSION BEFORE EDITING README.md. YOU PROBABLY DON'T NEED TO.

## Design system and UI

These conventions apply to the React canvas in `packages/review/app`:

- Reuse `src/ui/`, `icons.tsx`, `format.ts`, `option-menu.tsx`, and
  `notify.ts`. Extend existing pieces with variants instead of making local
  copies.
- Use StyleX with `tokens.*` and the steps in `scale.stylex.ts`; no raw colors,
  screen-only tokens or steps. Keep `stylex.create` values static: no spreads or
  helper calls.
- Keep styles beside the component. Use variants or `stylex.when.ancestor` with
  markers for contextual styling, not descendant selectors. Global CSS is only
  for resets, scope roots, and DOM the canvas does not render.
- Menus, confirmations, notifications, and tooltips use workbench host services
  through `session.bridge`, or `CanvasUiContext` on Home and onboarding. Reuse
  `setupTooltip` and `notify`; keep Code OSS imports out of the canvas.
- Keep rich content, forms, and inline feedback in React. Add a UI library only
  for a concrete behavior existing host or browser primitives cannot cover.
  In-page popovers use `Popover` from `ui/popover.tsx`, placed with
  `menuStyles.popover` or `shellStyles.topbarPopover`; browser fallbacks must
  not become a second Desktop UI.

## Stack conventions

- Use pnpm for the monorepo and the Node/pnpm versions in root `package.json`.
  Use npm for commands inside the vendored `apps/review-desktop/code-oss/`.
- The canvas uses React and Vite. Use TanStack Query (`canvas-query.tsx`) for
  API and bridge requests: `useQuery` / `useMutation`, not hand-written fetch
  effects. Keep local UI state out of the query cache; reuse existing Zustand
  stores for shared UI state.
- Add host capabilities to `packages/review-protocol/src/contracts.ts`, then run
  `pnpm --filter @dev.fast/review-desktop protocol:sync`. The fork's protocol
  copy is generated and gitignored.
- Prefer named static imports from public package entry points over namespace
  imports.

## Testing

Do not add [Change Detector Tests](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html). If you come across one, instead of updating it as part of a change, delete it. Check with the author if it should be replaced, do not assume it should be.

- Check UI changes in an isolated Desktop launched with
  `DEV_FAST_REVIEW_DESKTOP_BACKGROUND=1`: light/dark themes, narrow layouts,
  keyboard navigation, hover/focus, and reduced motion. For host controls, also
  check cancellation, focus restoration, disposal, and zoom. Browser tests do
  not load workbench CSS or host services. Do not test CSS text.
- Run `pnpm lint` and `pnpm format` from the repo root for code changes.
