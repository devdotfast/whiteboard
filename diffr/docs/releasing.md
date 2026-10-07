# Releasing diffr

Start from current `origin/main` and choose an unused `X.Y.Z` version.

1. Bump the CLI, core, and grammar versions in `Cargo.toml`,
   `crates/diffr-core/Cargo.toml`, and `crates/diffr-grammars/Cargo.toml`.
   Update their internal dependency versions, `Cargo.lock`, and
   `diffr-ts/package.json`. The plugin SDK has its own release cycle.
2. Verify the crates outside the checkout:
   `cargo package --locked -p diffr-grammars -p diffr-core -p diffr-cli`.
   Cargo stages the internal dependencies locally and builds the extracted
   archives. Symlinks under the library crates point to the repository's
   canonical assets; Cargo packages their contents as regular files.
3. Merge the release PR after CI passes, then push an annotated tag matching
   the version exactly, without a `v` prefix.
4. Verify the Release workflow. It builds five platform archives, generates
   checksums and a Homebrew formula, tests installation, publishes the GitHub
   release and npm packages, and tests npm installation on all five platforms.
   npm may take several minutes to expose an accepted publication; if smoke
   tests fail because the version is unavailable, wait for it to appear and
   rerun the failed jobs.
5. Run the Homebrew tap's **Update diffr** workflow, or wait for its hourly run.
6. Publish to crates.io with Cargo credentials configured through `cargo login`
   or `CARGO_REGISTRY_TOKEN`:
   `cargo publish --locked -p diffr-grammars -p diffr-core -p diffr-cli`.
   Cargo publishes in dependency order. The crates.io CLI package is
   `diffr-cli`; its installed executable is `diffr`. The name `diffr` on
   crates.io belongs to a different project.

Verify the registry version and, in a fresh install directory, run:

```sh
cargo install diffr-cli --version X.Y.Z --locked --root /tmp/diffr-release-check
/tmp/diffr-release-check/bin/diffr --version
```
