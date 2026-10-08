# Engine benchmarks

From a fresh checkout with the pinned Rust toolchain and the platform's C/C++ compiler installed:

```sh
cargo bench --locked --bench engine
```

Cargo builds optimized code using the repository's release settings (including thin LTO). Criterion reports time per iteration, confidence intervals, and throughput, and keeps results in `target/criterion`. One engine/shape iteration processes all four files, sequentially, through one plugin worker. The fixture is bundled; no GitHub access, local checkout, browser, model endpoint, or running server is needed. Cargo may download dependencies on the first build.

To check that every benchmark executes successfully without collecting a full measurement:

```sh
cargo bench --locked --bench engine -- --test
```

Filter a measurement or retain a named baseline:

```sh
cargo bench --locked --bench engine -- 'engine/pr998/default' --save-baseline before
# Change/rebuild the engine, keeping the benchmark and fixture unchanged.
cargo bench --locked --bench engine -- 'engine/pr998/default' --baseline before
cargo bench --locked --bench engine -- 'shape/pr998/context'
```

Use the same machine, toolchain, Cargo profile, target, allocator, and `RUSTFLAGS` when comparing revisions. Keep `target/criterion` (or a shared `CARGO_TARGET_DIR`) across the runs. Record `rustc -Vv`, `git rev-parse HEAD`, and any profile/environment overrides with results. Avoid concurrent builds or other CPU-heavy work. No fixed timing threshold is asserted: results vary by hardware.

## What is measured

| Benchmark | Inside timing | Outside timing |
| --- | --- | --- |
| `init/queries/default` | Compile all default enabled plugin queries; drop resulting parameters | Configuration construction, component loading |
| `init/queries/no_context` | Same, with context disabled | Same |
| `engine/pr998/default` | Parse, structural diff, syntax highlighting, project trees, run enabled shape plugins, dispose results | Query compilation, component compilation/instantiation, fixture loading, preflight validation |
| `engine/pr998/no_context` | Same, with context and its contributed queries disabled | Same |
| `shape/pr998/context` | Run only context on fresh default-query trees, including worker dispatch and result disposal | Parsing, diffing, projection, query compilation, component loading, cloning inputs |

The no-context run changes both query input and output semantics. Its difference from default is not a clean measurement of only the context visitor. The shape benchmark isolates that visitor on the same precomputed trees; other shaping plugins have not run on those trees. These timings are not additive.

Every engine fixture must remain a structural text diff (fallback is an error), and an untimed preflight checks that plugins succeed and preserve both source texts. The shape benchmark clones its input outside each timed invocation because plugins mutate trees: it never reuses already-folded output. `black_box` consumes results. Criterion uses ten samples, a one-second warmup, and a five-second target measurement window; slow workloads may take longer.

This measures the native CLI engine and its real Wasmtime component host. It excludes classification, Git/network I/O, JSON serialization, terminal/browser rendering, and process startup. It is not a measurement of the browser's directly linked WASM engine and its numbers should not be compared directly with browser timings. It selects the same allocator as the CLI: jemalloc where the CLI uses it, otherwise the platform's default Rust allocator.

## Plugin source changes

A fresh clone contains the bundled `plugin.wasm` components, so `cargo bench` works without first building them. Cargo recompiles Rust host changes, but plugin Rust sources run through those bundled components. After changing a plugin's Rust source, rebuild its components before benchmarking:

```sh
cargo xtask build-plugins
cargo bench --locked --bench engine
```

The xtask uses the repository's plugin toolchain/build settings. Compare like-for-like component builds on both revisions. Otherwise you may accidentally measure old plugin code with new host code or queries.

## Fixture provenance

The four before/after pairs under `benches/fixtures/pr998` are from [Whiteboard PR #998](https://github.com/devdotfast/whiteboard/pull/998), “Let follow-ups go to Ask while it answers”:

- Before: `c460feb39af2308aa97b45eebb703420d75cb2f0`
- After: `6ce2c3ce2a5bb012235f83abca61770c3ff5592d`
- `packages/review/app/src/ask-composer.tsx`
- `packages/review/app/src/ask-panel.tsx`
- `packages/review/src/ask/thread-state.ts`
- `packages/review/src/ask/thread.ts`

Together they contain 215,152 UTF-8 bytes across both sides. They exercise large TypeScript/TSX files, nested JSX, sparse edits, and new methods—the workload used to investigate context-folding performance. This is a focused regression workload, not a representative score for every language or change type. The original MIT license is included alongside the inputs. `manifest.json` records per-file byte counts and SHA-256 hashes.
