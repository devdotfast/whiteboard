IMPORTANT: ASK FOR PERMISSION BEFORE EDITING README.md. YOU PROBABLY DON'T NEED TO.

## Design system and UI

These conventions apply to the React canvas in `packages/review/app`. `pnpm lint`
enforces the scales; the `deslop-ui` skill (`.agents/skills/deslop-ui`) checks
the rest before review.

- Build from `src/ui/` before writing markup or styles. Extend a kit piece with
  a variant instead of copying it; a second local copy of anything belongs in
  the kit. Kit modules never import app code.
  - Controls: `Button` (`variant`, `tone`; `buttonLook` for anchors),
    `IconButton` (`aria-pressed` for toggles), `SegmentedControl`, `Checkbox`,
    `Switch`, `TextField`, `TextArea`, `Select`, `fieldStyles.bare`.
  - Overlays: `Popover`, `Dialog`, `option-menu.tsx`; disclosures use
    `DisclosureChevron` with `disclosureStyles.toggle` and `chevronMarker` on
    the toggle.
  - Feedback: `Spinner` (`spinStyles.turning` for a turning icon),
    `EmptyState`, `StatusBanner`, `useCopy`, `useTooltip`, `notify.ts`.
  - Glyphs: icons live in `ui/icons.tsx` and agent marks in
    `ui/brand-icons.tsx` (`AgentLogo`), sized with `iconStyles`. Draw icons as
    SVG, not Unicode characters.
  - Fragments: `textStyles` (`truncate`, `clamp2`, `error`, `eyebrow`),
    `focusStyles.ring`/`ringInset`, `buttonStyles.reset`, `dividerStyles`,
    `surfaceStyles`. Settings use `Section`/`Row` from `settings-section.tsx`;
    times, durations and counts use `format.ts`.
- Use StyleX with `tokens.*` and the steps in `scale.stylex.ts` (`space`,
  `leading`, `fontSize`, `fontWeight`, `radius`, `motion`, `layer`,
  `elevation`); no raw colors, screen-only tokens or steps. Snap a value to the
  nearest step instead of adding one. Keep `stylex.create` values static: no
  spreads or helper calls.
- Reduced motion and the shared narrow breakpoint come from `stylex.env`; only a
  one-off layout breakpoint stays local. Every animation and transition has a
  reduced-motion branch. Stacking across surfaces uses `layer`.
- Keep styles beside the component. Use variants or `stylex.when.ancestor` with
  markers for contextual styling, not descendant selectors. Global CSS is only
  for resets, scope roots, and DOM the canvas does not render.
- Menus, confirmations, notifications, and tooltips use workbench host services
  through `session.bridge`, or `CanvasUiContext` on Home and onboarding. Reuse
  `useTooltip` and `notify`; keep Code OSS imports out of the canvas.
- Keep rich content, forms, and inline feedback in React. Add a UI library only
  for a concrete behavior existing host or browser primitives cannot cover.
  In-page popovers use `Popover` from `ui/popover.tsx`, placed with
  `menuStyles.popover` or `shellStyles.topbarPopover`; browser fallbacks must
  not become a second Desktop UI.
- Never disable a control while it has focus and works; guard the handler
  instead, or focus drops to the body. Overlays close on Escape and return focus
  to their trigger. DOM portaled outside `.review-app` takes `themeStyles.vars`.
- Errors inside a modal render inline with `role="alert"`: host notifications
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
- A style refactor that should not change pixels proves it with computed-style
  diffs before and after, with the pointer moved off the page, not by eye.
- Run `pnpm lint` and `pnpm format` from the repo root for code changes.
