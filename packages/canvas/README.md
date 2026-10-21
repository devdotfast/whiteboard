# @dev.fast/canvas

Renders a shared Whiteboard board's content (`review-share/1`), read-only, in a React page.

```tsx
import "@dev.fast/canvas/canvas.css";
import { Whiteboard } from "@dev.fast/canvas";
import wasmUrl from "@dev.fast/canvas/libavoid.wasm?url";

<Whiteboard share={{ manifest, objects }} wasmUrl={wasmUrl} />;
```

It renders the board's document only: no top bar, views or panels. `objects`
maps each object id in the manifest to its bytes. Code peeks show as
unavailable unless `inlineEditors` is given, for example
`createSourceViewer({ readSource })`.

It imports and renders on a server as an empty frame; the board draws once
it mounts in the browser.

The page provides React 19. Under a strict CSP:

- Keep the fonts as files (`font-src 'self'`): in Vite,
  `build.assetsInlineLimit: (file) => file.endsWith(".woff2") ? false : undefined`.
- Diagram edge routing compiles libavoid: `script-src` needs
  `'wasm-unsafe-eval'` and `'unsafe-eval'` (its bindings use `Function`).

```sh
pnpm --filter @dev.fast/canvas build
```
