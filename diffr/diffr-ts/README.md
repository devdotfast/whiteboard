# @dev.fast/diffr

TypeScript types and zod validators for diffr's NDJSON protocol, plus the diffr
executable. The package version matches the diffr release.

```ts
import { decodeStructuralDiffEvent } from "@dev.fast/diffr";
const event = decodeStructuralDiffEvent(line);
```

`diffrBinaryPath()` returns the executable from the `@dev.fast/diffr-<platform>-<arch>`
optional dependency npm installed for this machine, or `undefined` when there is none
(musl Linux, Windows arm64, or `--omit=optional`). Platforms: macOS arm64 and x64,
glibc Linux arm64 and x64, Windows x64.

## Wire changes

Keep these files in sync:

| Files (relative to `diffr/` in the Whiteboard repository) | Check |
|---|---|
| `crates/diffr-core/src/protocol/mod.rs`, `crates/diffr-core/src/pairing.rs`, `diffr-ts/src/contract.ts` | Contract tests against the binary; Rust version check |
| `docs/streaming.md` | Review against the wire format |
| `packages/tui/src/diffr/wire.ts` (v3 only) | TUI fixture tests |
| `../packages/review-protocol/package.json` and `../packages/review/package.json` | Exact package version pins |

## Release

Bump `diffr-ts/package.json` with `Cargo.toml`. The release workflow publishes the
platform packages and this package from the tag, using npm trusted publishing.
