# Third-Party Notices

This file records third-party license considerations for
`@dev.fast/whiteboard`. Before publishing to npm, distributing as source, or
shipping as a built app, refresh this file from the current lockfile:

```sh
pnpm --filter @dev.fast/whiteboard licenses list --json
pnpm --filter @dev.fast/whiteboard audit --json
pnpm --filter @dev.fast/whiteboard audit signatures --json
```

## License Summary

The dependency inventory currently includes these license families:

- `MIT`
- `Apache-2.0`
- `BSD-3-Clause`
- `CC0-1.0`
- `EPL-2.0`
- `ISC`
- `LGPL-2.1-or-later`
- `MPL-2.0`

Most dependencies are permissive (`MIT`, `Apache-2.0`, `BSD-3-Clause`,
`CC0-1.0`, or `ISC`). The non-permissive/copyleft-adjacent entries that need
explicit release attention are listed below.

## LGPL Notice

### `libavoid-js`

- Package: `libavoid-js`
- Version observed: `0.5.0-beta.5`
- License: `LGPL-2.1-or-later`
- Source: `https://github.com/Aksem/libavoid-js`
- npm: `https://www.npmjs.com/package/libavoid-js`

`libavoid-js` is pulled in transitively through `@mr_mint/elkjs-libavoid`,
which is used by the Review software map edge routing code. The review server
serves the dependency's `libavoid.wasm` asset for the local review app.

Before distributing a built app or package that contains `libavoid-js` or
`libavoid.wasm`, include the LGPL license text or a clear license reference,
preserve copyright notices, and provide the corresponding upstream source link.
If this dependency is modified or vendored, publish those modifications in the
form required by the LGPL.

## EPL Notice

### `elkjs`

- Package: `elkjs`
- Version observed: `0.11.1`
- License: `EPL-2.0`
- Source: `https://github.com/kieler/elkjs`
- npm: `https://www.npmjs.com/package/elkjs`

`elkjs` is used for graph layout in the review UI. Preserve its license and
copyright notices when distributing source or built artifacts that include it.

## MPL Notice

### `lightningcss`

- Package: `lightningcss`
- Version observed: `1.32.0`
- License: `MPL-2.0`
- Source: `https://github.com/parcel-bundler/lightningcss`
- npm: `https://www.npmjs.com/package/lightningcss`

`lightningcss` is present in the resolved dependency tree through build tooling.
If distributed as part of a binary/tooling bundle, preserve its license notices
and source reference.

## Direct Dependency Notes

Direct third-party runtime/UI dependencies currently include:

- `@hono/node-server` and `hono` (`MIT`)
- `@mr_mint/elkjs-libavoid` (`MIT`, with transitive `libavoid-js` under
  `LGPL-2.1-or-later`)
- `@speed-highlight/core` (`CC0-1.0`)
- `@vitejs/plugin-react` and `vite` (`MIT`, build-time only)
- `@xyflow/react` (`MIT`)
- `elkjs` (`EPL-2.0`)
- `fuzzysort` (`MIT`)
- `katex` (`MIT`, fonts `OFL-1.1`)
- `react` and `react-dom` (`MIT`)
- `semver` (`ISC`)
- `zod` (`MIT`)
- `zustand` (`MIT`)
- `yauzl` (`MIT`)

## Bundled VS Code Server

The published package carries `vscode-server/`, staged by
`apps/review-desktop/scripts/stage-vscode-server.mjs`. It is built from the
Code OSS fork (`MIT`) and carries the fork's `LICENSE.txt` and
`ThirdPartyNotices.txt`. It bundles:

- in the server and extension host (`MIT` unless noted): `@vscode/proxy-agent`,
  `agent-base`, `cookie`, `debug`, `http-proxy-agent`, `https-proxy-agent`,
  `ip-address`, `minimist`, `ms`, `smart-buffer`, `socks`,
  `socks-proxy-agent`, `supports-color`, `undici`, `vscode-regexpp` and
  `tslib` (`0BSD`)
- in the built-in language extensions (`MIT` unless noted): `@vscode/l10n`,
  `@vscode/sync-api-client`, `@vscode/sync-api-common`,
  `@vscode/sync-api-service`, `@vscode/ts-package-manager`, `jsonc-parser`,
  `request-light`, `semver` (`ISC`), `vscode-css-languageservice`,
  `vscode-html-languageservice`, `vscode-json-languageservice`,
  `vscode-languageclient`, `vscode-languageserver`,
  `vscode-languageserver-textdocument`, `vscode-tas-client` and `vscode-uri`
- `typescript` (`Apache-2.0`), for the built-in TypeScript extension
- `@vscode/ripgrep-universal` (`MIT`), whose `rg` binaries are ripgrep
  (`MIT OR Unlicense`)
- `@parcel/watcher` and its Linux prebuilds (`MIT`), with `detect-libc`
  (`Apache-2.0`), `is-glob`, `is-extglob` and `picomatch` (`MIT`)

Curated extensions are not bundled; `whiteboard remote extensions ensure`
downloads them from Open VSX on the remote.
