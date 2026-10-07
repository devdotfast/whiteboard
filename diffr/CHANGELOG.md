# Changelog

diffr's history before this file begins is difftastic's; see
https://github.com/Wilfred/difftastic/blob/master/CHANGELOG.md for releases
up to 0.71.

## 0.1.1

- Published to crates.io as `diffr-cli` (binary `diffr`) and
  `diffr-plugin-sdk`, with the bundled plugins as `diffr-plugin-*`.
- `cargo binstall diffr-cli` installs the prebuilt `diffr` from a release.

## 0.1.0

First public release of diffr as its own project.

- Structural diffs over Git ranges with `git diff` argument compatibility.
- Streaming NDJSON output (`--format ndjson`, `--stream-annotations`) for
  editor and GUI frontends.
- A plugin contract (`wit/plugin.wit`) with bundled plugins for context,
  deleted bodies, grouping, hidden files, removed runs, summaries and test
  bodies, plus external WASM component plugins.
- A shared configuration file edited through `diffr config`.
- An interactive terminal frontend, `diffr-tui`, derived from hunk.
