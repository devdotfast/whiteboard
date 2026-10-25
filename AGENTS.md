IMPORTANT: ASK FOR PERMISSION BEFORE EDITING README.md. YOU PROBABLY DON'T NEED TO.

## Design system and UI

These rules apply to the React canvas in `packages/review/app`. The `deslop-ui`
skill (`.agents/skills/deslop-ui`) holds the detailed checklist. Run it before
review.

- Build from the kit in `src/ui/`. Search it before you write markup or styles.
  Extend a kit piece with a variant instead of copying it. A second local copy
  of anything belongs in the kit. Kit modules never import app code.
- Use StyleX with `tokens.*` and the steps in `scale.stylex.ts`. No raw colors,
  screen-only tokens or steps. Snap to the nearest step; do not add one. Keep
  `stylex.create` values static: no spreads or helper calls.
- Reduced motion and the narrow breakpoint come from `stylex.env`. Every
  animation and transition has a reduced-motion branch. Stacking across
  surfaces uses `layer`.
- Keep styles beside the component. Use variants or `stylex.when.ancestor` with
  markers for contextual styling, not descendant selectors. Global CSS is only
  for resets, scope roots, and DOM the canvas does not render.
- Menus, confirmations, notifications and tooltips use host services through
  `session.bridge`, or `CanvasUiContext` on Home and onboarding. Keep Code OSS
  imports out of the canvas.
- Keep rich content, forms and inline feedback in React. Add a UI library only
  for a behavior host or browser primitives cannot cover. Browser fallbacks
  must not become a second Desktop UI.
- Never disable a control while it has focus and works; guard the handler.
  Overlays close on Escape and return focus to their trigger. DOM portaled
  outside `.review-app` takes `themeStyles.vars`.
- Errors inside a modal render inline with `role="alert"`. Host notifications
  sit under its backdrop.

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
