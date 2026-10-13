# Review canvas

`@dev.fast/review-canvas` is the private browser workspace used by Review Desktop.
It owns the React UI, layout libraries, Vite build, and browser tests. It stays
under `packages/review/app` so the existing canvas assets and shared-source
imports keep their locations; it has its own dependency graph and test runner.

```sh
pnpm --filter @dev.fast/review-canvas build
pnpm --filter @dev.fast/review-canvas test
pnpm --filter @dev.fast/review-canvas typecheck
```

Desktop copies `dist/desktop` into its canvas directory. The public
`@dev.fast/whiteboard` Node runtime does not depend on or package this workspace.
Shared document models and pure helpers are imported from the Review workspace;
the canvas consumes those sources during its build, not through runtime npm
installation.

## Data

The canvas uses TanStack Query (`canvas-query.tsx`) for local API and bridge
requests. Use `useQuery` or `useMutation` for new requests instead of
hand-written fetch effects; keep local UI state out of it.

## Styles

Canvas styles are StyleX, written with `stylex.create` next to the component
that renders the element (`src`). Shared pieces:
`tokens.stylex.ts` (typed references to the theme's custom properties),
`scale.stylex.ts`, `theme-styles.ts`, `controls-styles.ts`,
`markers.stylex.ts` and the `ui/` components.

- Use `tokens.*`, not raw colors.
- For a different look inside another component, pass a variant or use
  `stylex.when.ancestor` with a marker, not a descendant selector.
- `global.css` holds only what StyleX cannot reach: the scope root, element
  resets, and DOM the canvas does not render (workbench-mounted views, React
  Flow internals, `::highlight()`). Don't add component styles there.
- StyleX rules outrank the workbench's own CSS, which the browser tests don't
  load, so check changes in the built canvas in Desktop (light, dark, narrow,
  hover/focus, reduced motion). Do not add tests that assert CSS text.
